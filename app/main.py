"""
SeatWatch FastAPI Application Entry Point
"""

import os
from contextlib import asynccontextmanager
from typing import Any, Dict, Optional
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from app.bms_client import BMSClient
from app.database import (
    create_monitor,
    delete_monitor,
    get_all_monitors,
    get_logs,
    get_monitor_by_id,
    get_settings,
    init_db,
    update_monitor_status,
    update_setting,
)
from app.notifier import TelegramNotifier, DEFAULT_BOT_TOKEN
from app.scheduler import scheduler_instance
from app.telegram_service import telegram_pairing_service


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    init_db()
    scheduler_instance.start()
    telegram_pairing_service.start_poller()
    yield
    # Shutdown
    telegram_pairing_service.stop_poller()
    scheduler_instance.shutdown()


app = FastAPI(
    title="SeatWatch API",
    description="BookMyShow Seat Availability Monitoring System",
    version="1.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

bms_client = BMSClient()
notifier = TelegramNotifier()

STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")
os.makedirs(STATIC_DIR, exist_ok=True)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/favicon.ico", include_in_schema=False)
def serve_favicon():
    fav_file = os.path.join(STATIC_DIR, "favicon.svg")
    if os.path.exists(fav_file):
        return FileResponse(fav_file, media_type="image/svg+xml")
    from fastapi import Response
    return Response(status_code=204)


@app.api_route("/health", methods=["GET", "HEAD"])
@app.api_route("/api/health", methods=["GET", "HEAD"])
def health_check():
    """Liveness & health probe for cloud monitoring, Docker, and uptime services."""
    try:
        monitors = get_all_monitors()
        scheduler_running = bool(scheduler_instance.scheduler and scheduler_instance.scheduler.running)
        return {
            "status": "healthy",
            "service": "SeatWatch",
            "scheduler": "running" if scheduler_running else "stopped",
            "active_monitors": sum(1 for m in monitors if m.get("status") == "ACTIVE"),
            "total_monitors": len(monitors),
        }
    except Exception as e:
        return {"status": "degraded", "error": str(e)}


@app.api_route("/", methods=["GET", "HEAD"])
def serve_index():
    index_file = os.path.join(STATIC_DIR, "index.html")
    if os.path.exists(index_file):
        return FileResponse(index_file)
    return {"message": "SeatWatch API is live. Static frontend index.html not yet built."}


# ---------------------
# Live BMS Discovery APIs
# ---------------------

@app.get("/api/regions")
def get_regions():
    try:
        return bms_client.get_regions()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/movies")
def get_movies(city_slug: str = Query("hyderabad")):
    try:
        movies = bms_client.get_movies(city_slug=city_slug)
        return {"city_slug": city_slug, "movies": movies}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/cinemas")
def get_cinemas(city_slug: str = Query("hyderabad")):
    """Get all cinemas in a city."""
    try:
        cinemas = bms_client.get_cinemas(city_slug=city_slug)
        return {"city_slug": city_slug, "cinemas": cinemas}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/cinema_showtimes")
def get_cinema_showtimes(
    city_slug: str,
    venue_code: str,
    date_code: str,
    venue_slug: Optional[str] = None,
    venue_name: Optional[str] = None
):
    """Get all movies, screens, formats, and showtimes for a specific cinema on a date."""
    try:
        data = bms_client.get_cinema_showtimes(
            city_slug=city_slug,
            venue_code=venue_code,
            date_code=date_code,
            venue_slug=venue_slug,
            venue_name=venue_name
        )
        return data
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/theatres")
def get_theatres(
    city_slug: str,
    movie_slug: str,
    event_code: str,
    city_code: str,
    date_code: str,
):
    try:
        data = bms_client.get_theatres_and_showtimes(
            city_slug=city_slug,
            movie_slug=movie_slug,
            event_code=event_code,
            city_code=city_code,
            date_code=date_code,
        )
        return data
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/seats")
def get_seats(
    venue_code: str,
    session_id: str,
    region_code: str = "HYD",
    region_slug: str = "hyderabad",
    screen: Optional[str] = "",
):
    try:
        data = bms_client.get_seat_layout(
            venue_code=venue_code,
            session_id=session_id,
            region_code=region_code,
            region_slug=region_slug,
        )
        if data.get("total_seats", 0) == 0:
            # Fallback to reference layout for sold out or unrendered layouts
            ref = bms_client.get_reference_layout(
                venue_code=venue_code,
                screen_name=screen,
                city_slug=region_slug
            )
            if ref and ref.get("total_seats", 0) > 0:
                ref["is_sold_out"] = True
                ref["session_id"] = session_id
                ref["message"] = data.get("message") or "This show is currently 100% booked on BMS. Showing screen layout so you can set cancellation alerts!"
                return ref
        return data
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/reference_layout")
def get_reference_layout(
    venue_code: str,
    screen: Optional[str] = "",
    city_slug: str = "hyderabad"
):
    """
    Returns reference screen layout (with aisles and physical seats) for unopened future dates
    so users can visually inspect the hall and configure monitoring rules.
    """
    try:
        data = bms_client.get_reference_layout(
            venue_code=venue_code,
            screen_name=screen,
            city_slug=city_slug
        )
        return data
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------
# Monitor Management APIs
# ---------------------

class MonitorCreateRequest(BaseModel):
    title: Optional[str] = None
    city_code: str
    city_slug: str
    movie_title: str
    movie_slug: str
    event_code: str
    venue_name: str
    venue_code: str
    target_date: str
    format_filter: Optional[str] = ""
    session_id: Optional[str] = ""
    rule_type: str = "ZONES"  # ZONES, EXACT, RANGE, CONSECUTIVE, CATEGORY, BOOKING_OPEN
    rule_payload: Dict[str, Any]
    interval_minutes: Optional[float] = 2.0
    booking_url: Optional[str] = ""


@app.get("/api/monitors")
def list_monitors(telegram_chat_id: Optional[str] = Query(None)):
    return get_all_monitors(telegram_chat_id=telegram_chat_id)


@app.post("/api/monitors")
def add_monitor(req: MonitorCreateRequest):
    data = req.model_dump()
    chat_id = str(data.get("rule_payload", {}).get("telegram_chat_id") or "").strip()
    if not chat_id:
        raise HTTPException(
            status_code=400,
            detail="A connected Telegram account (Chat ID) is required to receive seat alerts. Please connect your Telegram bot first."
        )
    monitor_id = create_monitor(data)
    scheduler_instance.schedule_monitor(monitor_id, data.get("interval_minutes", 2.0))
    return {"success": True, "monitor_id": monitor_id, "message": "Monitor created and activated!"}


@app.get("/api/monitors/{monitor_id}")
def get_monitor(monitor_id: int):
    m = get_monitor_by_id(monitor_id)
    if not m:
        raise HTTPException(status_code=404, detail="Monitor not found")
    return m


@app.post("/api/monitors/{monitor_id}/check_now")
async def trigger_check_now(monitor_id: int):
    res = await scheduler_instance.execute_check(monitor_id)
    return res


@app.post("/api/monitors/{monitor_id}/pause")
def pause_monitor(monitor_id: int):
    scheduler_instance.unschedule_monitor(monitor_id)
    update_monitor_status(monitor_id, "PAUSED", "Monitor paused by user")
    return {"success": True, "message": "Monitor paused"}


@app.post("/api/monitors/{monitor_id}/resume")
def resume_monitor(monitor_id: int):
    m = get_monitor_by_id(monitor_id)
    if not m:
        raise HTTPException(status_code=404, detail="Monitor not found")
    update_monitor_status(monitor_id, "ACTIVE", "Resumed by user")
    scheduler_instance.schedule_monitor(monitor_id, m.get("interval_minutes", 2.0))
    return {"success": True, "message": "Monitor resumed"}


@app.delete("/api/monitors/{monitor_id}")
def remove_monitor(monitor_id: int):
    scheduler_instance.unschedule_monitor(monitor_id)
    delete_monitor(monitor_id)
    return {"success": True, "message": "Monitor deleted"}


@app.get("/api/monitors/{monitor_id}/logs")
def view_logs(monitor_id: int):
    return get_logs(monitor_id)


# ---------------------
# Settings & Telegram APIs
# ---------------------

class SettingsUpdateRequest(BaseModel):
    telegram_bot_token: Optional[str] = None
    telegram_chat_id: Optional[str] = None
    default_interval_minutes: Optional[str] = None


@app.get("/api/settings")
def read_settings():
    return get_settings()


@app.post("/api/settings")
def write_settings(req: SettingsUpdateRequest):
    if req.telegram_bot_token is not None:
        update_setting("telegram_bot_token", req.telegram_bot_token.strip())
    if req.telegram_chat_id is not None:
        update_setting("telegram_chat_id", req.telegram_chat_id.strip())
    if req.default_interval_minutes is not None:
        update_setting("default_interval_minutes", req.default_interval_minutes.strip())
    return {"success": True, "settings": get_settings()}


class TelegramTestRequest(BaseModel):
    token: Optional[str] = None
    chat_id: str


@app.post("/api/test_telegram")
async def test_telegram(req: TelegramTestRequest):
    settings = get_settings()
    token = (req.token and req.token.strip()) or settings.get("telegram_bot_token") or DEFAULT_BOT_TOKEN
    res = await notifier.send_test_message(token, req.chat_id.strip())
    return res


# -----------------------------------------------------------------------------
# 1-Click Telegram Deep-Link Pairing APIs
# -----------------------------------------------------------------------------
@app.get("/api/telegram/pair_code")
async def get_pair_code():
    session = telegram_pairing_service.create_pairing_session()
    return {"success": True, **session}


@app.get("/api/telegram/pair_status")
async def get_pair_status(code: str = Query(...)):
    status = telegram_pairing_service.get_pairing_status(code)
    return {"success": True, **status}


@app.post("/api/telegram/disconnect")
async def disconnect_telegram():
    update_setting("telegram_chat_id", "")
    update_setting("telegram_user_name", "")
    return {"success": True, "message": "Telegram disconnected"}
