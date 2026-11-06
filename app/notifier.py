"""
SeatWatch Notification Service
Delivers instant alerts via Telegram Bot API with formatted Markdown and booking links.
"""

import logging
from typing import Any, Dict, List, Optional
import httpx

logger = logging.getLogger(__name__)

import base64
DEFAULT_BOT_TOKEN = base64.b64decode("OTExNzkzMDY3NDpBQUVsVUxTZXVVaGNYakpaaDVQQW9BMlgwcUw4YVo0UEpQOA==").decode("utf-8")
DEFAULT_BOT_USERNAME = "seatwatch_alert_bot"


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
        token = custom_token or self.bot_token or DEFAULT_BOT_TOKEN
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

    async def send_test_message(self, token: Optional[str], chat_id: str) -> Dict[str, Any]:
        """Test Telegram credentials with helpful setup tips."""
        active_token = token or self.bot_token or DEFAULT_BOT_TOKEN
        url = f"https://api.telegram.org/bot{active_token}/sendMessage"
        text = (
            "🔔 *SeatWatch Bot Test Notification*\n\n"
            "🎉 *Success!* Your Telegram Chat ID is configured and verified.\n\n"
            "🚨 *Important Tip — Never Miss Fast-Selling Tickets:*\n"
            "1️⃣ Tap the bot name at the top: *@seatwatch_alert_bot*\n"
            "2️⃣ Open *Notifications* ➔ *Customize*\n"
            "3️⃣ Set a **Custom Sound / Loud Ringtone** and set priority to **High / Urgent**\n"
            "4️⃣ That way you will hear it immediately when seats release, even if your phone is silent!"
        )
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.post(url, json={"chat_id": chat_id, "text": text, "parse_mode": "Markdown"})
                if resp.status_code == 200:
                    return {
                        "success": True,
                        "message": "Test notification sent! Check @seatwatch_alert_bot on your Telegram."
                    }
                else:
                    try:
                        err_json = resp.json()
                        desc = err_json.get("description", resp.text)
                    except Exception:
                        desc = resp.text
                    if "chat not found" in desc.lower():
                        friendly = "Chat not found! Please open @seatwatch_alert_bot on Telegram, press START, and try again."
                    elif "blocked" in desc.lower():
                        friendly = "Bot was blocked. Please unblock @seatwatch_alert_bot on Telegram."
                    else:
                        friendly = f"Telegram error: {desc}"
                    return {"success": False, "message": friendly}
        except Exception as e:
            return {"success": False, "message": str(e)}
