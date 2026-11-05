"""
SeatWatch Notification Service
Delivers instant alerts via Telegram Bot API with formatted Markdown and booking links.
"""

import logging
from typing import Any, Dict, List, Optional
import httpx

logger = logging.getLogger(__name__)


class TelegramNotifier:
    def __init__(self, bot_token: Optional[str] = None, chat_id: Optional[str] = None):
        self.bot_token = bot_token
        self.chat_id = chat_id

    async def send_alert(
        self,
        movie_title: str,
        theatre_name: str,
        show_time: str,
        target_date: str,
        available_seats: List[str],
        booking_url: str,
        format_info: str = "Standard",
        explanation: str = "",
        custom_token: Optional[str] = None,
        custom_chat_id: Optional[str] = None,
    ) -> bool:
        token = custom_token or self.bot_token
        chat_id = custom_chat_id or self.chat_id

        if not token or not chat_id:
            logger.warning("Telegram Bot Token or Chat ID not configured. Skipping push notification.")
            return False

        # Format date for display: YYYYMMDD -> YYYY-MM-DD
        display_date = target_date
        if len(target_date) == 8 and target_date.isdigit():
            display_date = f"{target_date[6:8]}/{target_date[4:6]}/{target_date[:4]}"

        seat_list_str = ", ".join(available_seats[:20])
        if len(available_seats) > 20:
            seat_list_str += f" and {len(available_seats) - 20} more"

        message = (
            f"🚨 *SeatWatch Alert: Preferred Seats Available!*\n\n"
            f"🎬 *Movie:* {movie_title}\n"
            f"📍 *Theatre:* {theatre_name}\n"
            f"🎞 *Format:* {format_info}\n"
            f"📅 *Date:* {display_date}\n"
            f"⏰ *Showtime:* {show_time}\n"
            f"💺 *Seats Found:* `{seat_list_str}`\n\n"
            f"ℹ️ _{explanation}_\n\n"
            f"[👉 Click Here to Open BookMyShow & Book Now]({booking_url})"
        )

        url = f"https://api.telegram.org/bot{token}/sendMessage"
        payload = {
            "chat_id": chat_id,
            "text": message,
            "parse_mode": "Markdown",
            "disable_web_page_preview": False,
        }

        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.post(url, json=payload)
                if resp.status_code == 200:
                    logger.info("Telegram notification sent successfully!")
                    return True
                else:
                    logger.error(f"Telegram API error {resp.status_code}: {resp.text}")
                    return False
        except Exception as e:
            logger.error(f"Failed to send Telegram message: {e}")
            return False

    async def send_test_message(self, token: str, chat_id: str) -> Dict[str, Any]:
        """Test Telegram credentials."""
        url = f"https://api.telegram.org/bot{token}/sendMessage"
        text = "🔔 *SeatWatch Bot Test Notification*\n\nYour Telegram integration is working perfectly! You will receive live alerts when your preferred seats become available."
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.post(url, json={"chat_id": chat_id, "text": text, "parse_mode": "Markdown"})
                if resp.status_code == 200:
                    return {"success": True, "message": "Test notification sent successfully!"}
                else:
                    return {"success": False, "message": f"Telegram error: {resp.text}"}
        except Exception as e:
            return {"success": False, "message": str(e)}
