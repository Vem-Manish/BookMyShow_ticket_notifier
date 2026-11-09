"""
SeatWatch Telegram Deep-Link Pairing & Long-Polling Service
Allows 1-click zero-typing connection between Telegram user and SeatWatch dashboard.
"""

import asyncio
from datetime import datetime, timedelta
import logging
import secrets
from typing import Any, Dict, Optional
import httpx

from app.database import get_settings, update_setting
from app.notifier import DEFAULT_BOT_TOKEN, DEFAULT_BOT_USERNAME

logger = logging.getLogger(__name__)


class TelegramPairingService:
    def __init__(self):
        self.pairing_sessions: Dict[str, Dict[str, Any]] = {}
        self.running: bool = False
        self.poller_task: Optional[asyncio.Task] = None
        self.bot_username: str = DEFAULT_BOT_USERNAME

    def create_pairing_session(self) -> Dict[str, Any]:
        """Generate a unique 1-click deep-link pairing session."""
        self._cleanup_expired()
        code = "sw_" + secrets.token_hex(4)  # e.g. sw_a1b2c3d4
        session_data = {
            "code": code,
            "created_at": datetime.now(),
            "status": "PENDING",
            "chat_id": None,
            "first_name": None,
            "username": None,
        }
        self.pairing_sessions[code] = session_data
        deep_link = f"https://t.me/{self.bot_username}?start={code}"

        return {
            "code": code,
            "deep_link": deep_link,
            "bot_username": self.bot_username,
            "expires_in_seconds": 900
        }

    def get_pairing_status(self, code: str) -> Dict[str, Any]:
        """Check status of a pairing code."""
        self._cleanup_expired()
        session = self.pairing_sessions.get(code)
        if session:
            return {
                "status": session["status"],
                "chat_id": session.get("chat_id"),
                "first_name": session.get("first_name"),
                "username": session.get("username"),
            }

        # Fallback: if any recent session paired in this window
        for s in self.pairing_sessions.values():
            if s.get("status") == "PAIRED" and s.get("chat_id"):
                return {
                    "status": "PAIRED",
                    "chat_id": s.get("chat_id"),
                    "first_name": s.get("first_name"),
                    "username": s.get("username"),
                }
        return {"status": "EXPIRED_OR_NOT_FOUND"}

    def _cleanup_expired(self):
        cutoff = datetime.now() - timedelta(minutes=15)
        to_del = [k for k, v in self.pairing_sessions.items() if v["created_at"] < cutoff]
        for k in to_del:
            self.pairing_sessions.pop(k, None)

    def start_poller(self):
        """Start background long polling for incoming bot messages."""
        if not self.running:
            self.running = True
            self.poller_task = asyncio.create_task(self._polling_loop())
            logger.info("Telegram long-poller task started.")

    def stop_poller(self):
        """Stop background long polling."""
        self.running = False
        if self.poller_task:
            self.poller_task.cancel()
            self.poller_task = None
            logger.info("Telegram long-poller task stopped.")

    async def _send_telegram_reply(self, token: str, chat_id: str, text: str):
        url = f"https://api.telegram.org/bot{token}/sendMessage"
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.post(url, json={
                    "chat_id": chat_id,
                    "text": text,
                    "parse_mode": "Markdown"
                })
                if resp.status_code != 200:
                    # Fallback without markdown to guarantee delivery
                    clean_text = text.replace("*", "").replace("`", "").replace("_", "")
                    await client.post(url, json={
                        "chat_id": chat_id,
                        "text": clean_text
                    })
        except Exception as e:
            logger.error(f"Failed to send Telegram reply: {e}")

    async def _polling_loop(self):
        offset = 0
        logger.info("Telegram pairing listener initialized.")

        while self.running:
            try:
                self._cleanup_expired()

                settings = get_settings()
                token = settings.get("telegram_bot_token") or DEFAULT_BOT_TOKEN
                if not token:
                    await asyncio.sleep(5)
                    continue

                url = f"https://api.telegram.org/bot{token}/getUpdates"
                params = {"offset": offset, "timeout": 10, "limit": 10}

                async with httpx.AsyncClient(timeout=25) as client:
                    resp = await client.get(url, params=params)
                    if resp.status_code == 200:
                        data = resp.json()
                        updates = data.get("result", [])

                        for update in updates:
                            up_id = update.get("update_id", 0)
                            if up_id >= offset:
                                offset = up_id + 1

                            message = update.get("message") or update.get("channel_post")
                            if not message:
                                continue

                            chat = message.get("chat", {})
                            chat_id = str(chat.get("id", ""))
                            first_name = chat.get("first_name", "Friend")
                            username = chat.get("username", "")
                            text = (message.get("text") or "").strip()

                            if text.startswith("/start"):
                                parts = text.split()
                                pairing_code = parts[1].strip() if len(parts) > 1 else None

                                matched = False
                                # 1. Direct code match
                                if pairing_code and pairing_code in self.pairing_sessions:
                                    sess = self.pairing_sessions[pairing_code]
                                    sess["status"] = "PAIRED"
                                    sess["chat_id"] = chat_id
                                    sess["first_name"] = first_name
                                    sess["username"] = username
                                    matched = True

                                # 2. Match ANY active pending session(s) if code was omitted, expired, or regenerated
                                for s in self.pairing_sessions.values():
                                    if s.get("status") == "PENDING":
                                        s["status"] = "PAIRED"
                                        s["chat_id"] = chat_id
                                        s["first_name"] = first_name
                                        s["username"] = username
                                        matched = True

                                # Persist in database
                                update_setting("telegram_chat_id", chat_id)
                                update_setting("telegram_user_name", first_name)
                                logger.info(f"Telegram user {first_name} ({chat_id}) paired!")

                                # Send welcoming reply
                                welcome_msg = (
                                    f"🎉 *Successfully Connected to SeatWatch!*\n\n"
                                    f"Hey {first_name}! Your Telegram account is now connected.\n\n"
                                    f"Your Chat ID: `{chat_id}`\n\n"
                                    f"You will receive instant alerts here the exact second your preferred movie seats open up! 🍿\n\n"
                                    f"🚨 *Important Tip — Don't Miss Out:*\n"
                                    f"1️⃣ Tap the bot name at the top: *@seatwatch_alert_bot*\n"
                                    f"2️⃣ Open *Notifications* ➔ *Customize*\n"
                                    f"3️⃣ Set a **Custom Sound / Loud Ringtone** and set priority to **Urgent / High** so your phone alerts you loudly even when on silent!"
                                )
                                await self._send_telegram_reply(token, chat_id, welcome_msg)

                    elif resp.status_code == 409:
                        # Another process is polling getUpdates. Back off cleanly.
                        await asyncio.sleep(5)
                    else:
                        await asyncio.sleep(2)

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.debug(f"Telegram poller exception: {e}")
                await asyncio.sleep(3)


# Global singleton instance
telegram_pairing_service = TelegramPairingService()
