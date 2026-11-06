"""
SeatWatch Background Monitoring Scheduler
Executes periodic BookMyShow availability checks and triggers notifications.
"""

import asyncio
import logging
from datetime import datetime
from typing import Any, Dict, List, Optional
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.bms_client import BMSClient
from app.database import (
    add_log,
    get_all_monitors,
    get_monitor_by_id,
    get_settings,
    update_monitor_status,
)
from app.notifier import TelegramNotifier
from app.rules import RuleEvaluator

logger = logging.getLogger(__name__)


class MonitoringScheduler:
    def __init__(self):
        self.scheduler = AsyncIOScheduler()
        self.notifier = TelegramNotifier()
        self.bms = BMSClient()
        self.running_jobs: Dict[int, str] = {}
        self.last_alert_cache: Dict[int, Dict[str, Any]] = {}

    def start(self):
        if not self.scheduler.running:
            self.scheduler.start()
            logger.info("APScheduler started successfully.")
            self.sync_active_monitors()

    def shutdown(self):
        if self.scheduler.running:
            self.scheduler.shutdown()
            logger.info("APScheduler shut down.")

    def sync_active_monitors(self):
        """Register all ACTIVE monitors from the database into the scheduler."""
        monitors = get_all_monitors()
        for m in monitors:
            if m["status"] == "ACTIVE":
                self.schedule_monitor(m["id"], m.get("interval_minutes", 2.0))

    def schedule_monitor(self, monitor_id: int, interval_minutes: float = 2.0):
        job_id = f"monitor_{monitor_id}"
        # Remove existing if present
        if self.scheduler.get_job(job_id):
            self.scheduler.remove_job(job_id)

        # Schedule recurring execution
        self.scheduler.add_job(
            self.execute_check,
            "interval",
            minutes=interval_minutes,
            args=[monitor_id],
            id=job_id,
            name=f"Monitor Check #{monitor_id}",
            replace_existing=True,
            next_run_time=datetime.now() # trigger immediate first run
        )
        self.running_jobs[monitor_id] = job_id
        logger.info(f"Scheduled Monitor #{monitor_id} every {interval_minutes} minutes.")

    def unschedule_monitor(self, monitor_id: int):
        job_id = f"monitor_{monitor_id}"
        if self.scheduler.get_job(job_id):
            self.scheduler.remove_job(job_id)
        self.running_jobs.pop(monitor_id, None)
        self.last_alert_cache.pop(monitor_id, None)
        logger.info(f"Unscheduled Monitor #{monitor_id}.")

    async def execute_check(self, monitor_id: int) -> Dict[str, Any]:
        """Core check loop for a specific monitor."""
        monitor = get_monitor_by_id(monitor_id)
        if not monitor:
            self.unschedule_monitor(monitor_id)
            return {"status": "NOT_FOUND"}

        if monitor["status"] not in ["ACTIVE", "RUNNING"]:
            return {"status": monitor["status"], "message": f"Monitor is {monitor['status']}"}

        logger.info(f"Executing check for Monitor #{monitor_id} ({monitor['title']})...")

        venue_code = monitor["venue_code"]
        event_code = monitor["event_code"]
        city_code = monitor["city_code"]
        city_slug = monitor["city_slug"]
        movie_slug = monitor["movie_slug"]
        target_date = monitor["target_date"]
        session_id = monitor["session_id"]
        format_filter = (monitor["format_filter"] or "").lower()
        format_detected = monitor.get("format_filter") or "Standard"

        # Step 1: Discover all matching shows for this date & format
        candidate_shows: List[Dict[str, Any]] = []

        single_lock = (monitor.get("session_id") or "").strip()
        if single_lock and single_lock.lower() not in ["all", "", "none", "null"]:
            # Direct fast path: we already have the exact session ID to check!
            candidate_shows.append({
                "session_id": single_lock,
                "show_time": monitor.get("format_filter") or "Selected Show",
                "screen": monitor.get("format_filter") or "",
                "attributes": "",
                "booking_url": monitor.get("booking_url") or f"https://in.bookmyshow.com/booktickets/{venue_code}/{single_lock}"
            })

        # If not locked to a single session, discover live shows from cinema schedule
        if not candidate_shows:
            # 1. Cinema-centric lookup (shows ALL child formats, screens, and showtimes)
            try:
                c_data = self.bms.get_cinema_showtimes(
                    city_slug=city_slug,
                    venue_code=venue_code,
                    date_code=target_date,
                    include_predictions=False
                )
                if c_data.get("is_open") and not c_data.get("is_predicted"):
                    movie_target = monitor["movie_title"].strip().lower()
                    for m in c_data.get("movies", []):
                        m_title = (m.get("title") or "").strip().lower()
                        if movie_target in m_title or m_title in movie_target:
                            for f in m.get("formats", []):
                                f_name = (f.get("format_name") or "").lower()
                                f_attr = (f.get("attributes") or "").lower()
                                f_screen = (f.get("screen") or "").lower()
                                f_event = (f.get("event_code") or "").lower()
    
                                matches = False
                                if not format_filter or format_filter == "any format":
                                    matches = True
                                elif format_filter in f_name or format_filter in f_attr:
                                    matches = True
                                elif monitor.get("event_code") and monitor["event_code"].lower() == f_event:
                                    matches = True
                                else:
                                    tokens = [t.strip() for t in format_filter.replace("•", " ").split() if len(t.strip()) > 1]
                                    target_haystack = f"{f_name} {f_attr} {f_screen}"
                                    if tokens and all(t in target_haystack for t in tokens):
                                        matches = True
    
                                if matches:
                                    format_detected = f.get("format_name", format_detected)
                                    for sh in f.get("shows", []):
                                        sid = str(sh.get("session_id", "")).strip()
                                        if sid and not any(c["session_id"] == sid for c in candidate_shows):
                                            candidate_shows.append({
                                                "session_id": sid,
                                                "show_time": sh.get("show_time", "Show"),
                                                "screen": sh.get("screen", ""),
                                                "attributes": sh.get("attributes", ""),
                                                "booking_url": sh.get("booking_url") or f"https://in.bookmyshow.com/booktickets/{venue_code}/{sid}"
                                            })
            except Exception as e:
                logger.warning(f"Cinema showtimes check warning: {e}")

        # 2. Movie-centric lookup fallback
        if not candidate_shows:
            try:
                st_data = self.bms.get_theatres_and_showtimes(
                    city_slug=city_slug,
                    movie_slug=movie_slug,
                    event_code=event_code,
                    city_code=city_code,
                    date_code=target_date,
                )
                if st_data.get("is_open"):
                    for v in st_data.get("venues", []):
                        if v.get("venue_code") == venue_code:
                            for show in v.get("showtimes", []):
                                show_format = (show.get("format") or "").lower()
                                show_attr = (show.get("screen_attr") or "").lower()
                                if not format_filter or (format_filter in show_format or format_filter in show_attr):
                                    sid = str(show.get("session_id", "")).strip()
                                    if sid and not any(c["session_id"] == sid for c in candidate_shows):
                                        candidate_shows.append({
                                            "session_id": sid,
                                            "show_time": show.get("show_time", "Show"),
                                            "screen": show.get("screen_attr", ""),
                                            "attributes": show.get("screen_attr", ""),
                                            "booking_url": show.get("booking_url") or f"https://in.bookmyshow.com/booktickets/{venue_code}/{sid}"
                                        })
            except Exception as e:
                logger.warning(f"Movie showtimes fallback warning: {e}")

        # Step 1.5: Filter candidate shows by screen/tag filter (e.g. "PXL", "IMAX", "DOLBY") if configured
        rule_payload = monitor.get("rule_payload") or {}
        screen_filter = (rule_payload.get("screen_filter") or "").strip().lower()
        if screen_filter and screen_filter not in ["all", "any", "all screens", ""]:
            filtered = [
                c for c in candidate_shows
                if screen_filter in (c.get("screen") or "").lower() or screen_filter in (c.get("attributes") or "").lower()
            ]
            if filtered:
                candidate_shows = filtered
                logger.info(f"Screen filter '{screen_filter}' filtered to {len(candidate_shows)} matching shows.")
            else:
                logger.info(f"Shows found for format, but none match screen filter '{screen_filter}' yet.")
                candidate_shows = []

        # If user explicitly locked to a single session ID (and not ALL), filter to that session
        single_lock = monitor.get("session_id")
        if single_lock and single_lock not in ["ALL", "all", ""]:
            single_match = [c for c in candidate_shows if c["session_id"] == single_lock]
            if single_match:
                candidate_shows = single_match
            elif not candidate_shows:
                candidate_shows = [{
                    "session_id": single_lock,
                    "show_time": "Selected Show",
                    "screen": "",
                    "attributes": "",
                    "booking_url": monitor.get("booking_url") or f"https://in.bookmyshow.com/booktickets/{venue_code}/{single_lock}"
                }]

        # If no shows are currently open
        if not candidate_shows:
            status_msg = f"Bookings not yet opened for {target_date} matching '{format_filter or 'any'}'. Waiting..."
            update_monitor_status(monitor_id, "ACTIVE", status_msg)
            add_log(monitor_id, "WAITING", status_msg)
            return {"status": "WAITING", "message": status_msg}

        # Step 2: Fetch and evaluate seat layout for ALL candidate shows
        rule_type = monitor["rule_type"]
        rule_payload = monitor["rule_payload"]
        show_summaries: List[str] = []
        last_explanation: str = ""

        for sh in candidate_shows:
            sh_id = sh["session_id"]
            sh_time = sh["show_time"]
            sh_url = sh["booking_url"]

            try:
                seat_data = self.bms.get_seat_layout(
                    venue_code=venue_code,
                    session_id=sh_id,
                    region_code=city_code,
                    region_slug=city_slug
                )
            except Exception as e:
                err_msg = str(e)
                logger.warning(f"Failed to retrieve seat layout for show {sh_time} (Session {sh_id}): {err_msg}")
                show_summaries.append(f"{sh_time}: layout check pending")
                if not last_explanation:
                    last_explanation = "Layout check pending"
                continue

            open_count = seat_data.get("available_count", 0)
            show_summaries.append(f"{sh_time}: {open_count} open")

            is_satisfied, matched_seats, explanation = RuleEvaluator.evaluate(
                rule_type=rule_type,
                rule_payload=rule_payload,
                seat_data=seat_data
            )
            last_explanation = explanation

            if is_satisfied:
                # Target seats found!
                settings = get_settings()
                token = settings.get("telegram_bot_token")
                chat_id = rule_payload.get("telegram_chat_id") or settings.get("telegram_chat_id")

                # Check alert throttle cache so user isn't spammed every check for identical seats
                now = datetime.now()
                last_alert = self.last_alert_cache.get(monitor_id)
                should_send_telegram = True

                if last_alert:
                    prev_seats = set(last_alert.get("seats", []))
                    curr_seats = set(matched_seats)
                    last_time = last_alert.get("time", now)
                    elapsed_mins = (now - last_time).total_seconds() / 60.0

                    # Throttle duplicate alerts for the exact same seats to every 15 minutes
                    if curr_seats == prev_seats and elapsed_mins < 15.0:
                        should_send_telegram = False

                alert_sent = False
                if should_send_telegram and token and chat_id:
                    alert_sent = await self.notifier.send_alert(
                        movie_title=monitor["movie_title"],
                        theatre_name=monitor["venue_name"],
                        show_time=sh_time,
                        target_date=target_date,
                        available_seats=matched_seats,
                        booking_url=sh_url,
                        format_info=format_detected,
                        explanation=f"Found in {sh_time} show! {explanation}",
                        custom_token=token,
                        custom_chat_id=chat_id
                    )
                    if alert_sent:
                        self.last_alert_cache[monitor_id] = {
                            "seats": matched_seats,
                            "time": now,
                            "show_time": sh_time
                        }

                final_msg = f"🎯 SEATS AVAILABLE in {sh_time} show! {explanation}"
                if alert_sent:
                    final_msg += " (Telegram alert dispatched)"
                elif not should_send_telegram:
                    final_msg += " (Continuous watch active • Alert reminder throttled)"

                # Keep monitor ACTIVE so it continues monitoring continuously until manually paused or deleted
                update_monitor_status(monitor_id, "ACTIVE", final_msg, session_id=sh_id, booking_url=sh_url)
                add_log(monitor_id, "SEATS_FOUND", final_msg, seats_found=", ".join(matched_seats))

                return {
                    "status": "ACTIVE",
                    "matched_seats": matched_seats,
                    "explanation": explanation,
                    "show_time": sh_time,
                    "session_id": sh_id,
                    "message": final_msg
                }

        # None of the candidate shows satisfy the rule yet
        summary_str = ", ".join(show_summaries) if show_summaries else "Live check"
        if not last_explanation:
            last_explanation = "None of the selections currently match"
        status_msg = f"Active check across {len(candidate_shows)} show(s) ({summary_str}): {last_explanation}"
        update_monitor_status(monitor_id, "ACTIVE", status_msg)
        add_log(monitor_id, "CHECKED", status_msg)
        return {
            "status": "ACTIVE",
            "candidate_shows": len(candidate_shows),
            "explanation": last_explanation
        }


# Global Singleton Scheduler
scheduler_instance = MonitoringScheduler()
