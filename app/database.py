"""
SQLite Database Layer for SeatWatch Monitors and Settings
"""

import json
import os
import sqlite3
from datetime import datetime
from typing import Any, Dict, List, Optional

DB_PATH = os.getenv("SEATWATCH_DB_PATH", os.path.join(os.path.dirname(os.path.dirname(__file__)), "seatwatch.db"))

import base64
DEFAULT_BOT_TOKEN = base64.b64decode("OTExNzkzMDY3NDpBQUVsVUxTZXVVaGNYakpaaDVQQW9BMlgwcUw4YVo0UEpQOA==").decode("utf-8")
DEFAULT_BOT_USERNAME = "seatwatch_alert_bot"


def get_connection() -> sqlite3.Connection:
    db_dir = os.path.dirname(os.path.abspath(DB_PATH))
    if db_dir:
        os.makedirs(db_dir, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS monitors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        city_code TEXT NOT NULL,
        city_slug TEXT NOT NULL,
        movie_title TEXT NOT NULL,
        movie_slug TEXT NOT NULL,
        event_code TEXT NOT NULL,
        venue_name TEXT NOT NULL,
        venue_code TEXT NOT NULL,
        target_date TEXT NOT NULL,
        format_filter TEXT DEFAULT '',
        session_id TEXT DEFAULT '',
        rule_type TEXT NOT NULL,
        rule_payload TEXT NOT NULL,
        interval_minutes REAL DEFAULT 2.0,
        status TEXT DEFAULT 'ACTIVE',
        last_checked_at TEXT,
        last_status_message TEXT DEFAULT 'Initialized',
        booking_url TEXT DEFAULT '',
        created_at TEXT NOT NULL
    );
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS check_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        monitor_id INTEGER NOT NULL,
        timestamp TEXT NOT NULL,
        status TEXT NOT NULL,
        message TEXT NOT NULL,
        seats_found TEXT DEFAULT '',
        FOREIGN KEY (monitor_id) REFERENCES monitors (id) ON DELETE CASCADE
    );
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS screen_layouts (
        venue_code TEXT NOT NULL,
        screen_name TEXT NOT NULL,
        layout_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (venue_code, screen_name)
    );
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );
    """)

    # Default settings
    cursor.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('telegram_bot_token', ?);", (DEFAULT_BOT_TOKEN,))
    cursor.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('telegram_chat_id', '');")
    cursor.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('default_interval_minutes', '2');")

    # Ensure any previously triggered monitors continue monitoring
    cursor.execute("UPDATE monitors SET status = 'ACTIVE' WHERE status = 'TRIGGERED';")
    cursor.execute("UPDATE settings SET value = ? WHERE key = 'telegram_bot_token' AND (value IS NULL OR value = '');", (DEFAULT_BOT_TOKEN,))

    # Ensure telegram_chat_id column exists
    try:
        cursor.execute("ALTER TABLE monitors ADD COLUMN telegram_chat_id TEXT DEFAULT '';")
    except Exception:
        pass

    try:
        cursor.execute('''
            UPDATE monitors 
            SET telegram_chat_id = json_extract(rule_payload, '$.telegram_chat_id')
            WHERE (telegram_chat_id IS NULL OR telegram_chat_id = '')
              AND json_extract(rule_payload, '$.telegram_chat_id') IS NOT NULL
        ''')
    except Exception:
        pass

    conn.commit()
    conn.close()


def get_all_monitors(telegram_chat_id: Optional[str] = None) -> List[Dict[str, Any]]:
    conn = get_connection()
    cursor = conn.cursor()
    if telegram_chat_id and str(telegram_chat_id).strip():
        cid = str(telegram_chat_id).strip()
        cursor.execute("""
            SELECT * FROM monitors 
            WHERE telegram_chat_id = ? 
               OR rule_payload LIKE ?
            ORDER BY id DESC
        """, (cid, f'%"telegram_chat_id": "{cid}"%'))
    else:
        cursor.execute("SELECT * FROM monitors ORDER BY id DESC")
    rows = cursor.fetchall()
    conn.close()

    result = []
    for r in rows:
        d = dict(r)
        try:
            d["rule_payload"] = json.loads(d["rule_payload"])
        except Exception:
            d["rule_payload"] = {}
        result.append(d)
    return result


def get_monitor_by_id(monitor_id: int) -> Optional[Dict[str, Any]]:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM monitors WHERE id = ?", (monitor_id,))
    row = cursor.fetchone()
    conn.close()
    if not row:
        return None
    d = dict(row)
    try:
        d["rule_payload"] = json.loads(d["rule_payload"])
    except Exception:
        d["rule_payload"] = {}
    return d


def create_monitor(data: Dict[str, Any]) -> int:
    conn = get_connection()
    cursor = conn.cursor()
    now_str = datetime.now().isoformat()

    rule_dict = data.get("rule_payload", {})
    chat_id = str(data.get("telegram_chat_id") or rule_dict.get("telegram_chat_id") or "").strip()
    rule_payload = json.dumps(rule_dict)
    cursor.execute("""
    INSERT INTO monitors (
        title, city_code, city_slug, movie_title, movie_slug, event_code,
        venue_name, venue_code, target_date, format_filter, session_id,
        rule_type, rule_payload, interval_minutes, status, last_status_message,
        booking_url, created_at, telegram_chat_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', 'Scheduled', ?, ?, ?)
    """, (
        data.get("title", f"{data.get('movie_title')} - {data.get('venue_name')}"),
        data.get("city_code", "HYD"),
        data.get("city_slug", "hyderabad"),
        data.get("movie_title"),
        data.get("movie_slug"),
        data.get("event_code"),
        data.get("venue_name"),
        data.get("venue_code"),
        data.get("target_date"),
        data.get("format_filter", ""),
        data.get("session_id", ""),
        data.get("rule_type", "RANGE"),
        rule_payload,
        float(data.get("interval_minutes", 2.0)),
        data.get("booking_url", ""),
        now_str,
        chat_id
    ))
    monitor_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return monitor_id


def update_monitor_status(
    monitor_id: int,
    status: str,
    status_message: str,
    session_id: Optional[str] = None,
    booking_url: Optional[str] = None
):
    conn = get_connection()
    cursor = conn.cursor()
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    query = "UPDATE monitors SET status = ?, last_status_message = ?, last_checked_at = ?"
    params = [status, status_message, now_str]

    if session_id:
        query += ", session_id = ?"
        params.append(session_id)
    if booking_url:
        query += ", booking_url = ?"
        params.append(booking_url)

    query += " WHERE id = ?"
    params.append(monitor_id)

    cursor.execute(query, params)
    conn.commit()
    conn.close()


def delete_monitor(monitor_id: int):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM monitors WHERE id = ?", (monitor_id,))
    cursor.execute("DELETE FROM check_logs WHERE id = ?", (monitor_id,))
    conn.commit()
    conn.close()


def add_log(monitor_id: int, status: str, message: str, seats_found: str = ""):
    conn = get_connection()
    cursor = conn.cursor()
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    cursor.execute("""
    INSERT INTO check_logs (monitor_id, timestamp, status, message, seats_found)
    VALUES (?, ?, ?, ?, ?)
    """, (monitor_id, now_str, status, message, seats_found))
    conn.commit()
    conn.close()


def get_logs(monitor_id: int, limit: int = 50) -> List[Dict[str, Any]]:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
    SELECT * FROM check_logs WHERE monitor_id = ? ORDER BY id DESC LIMIT ?
    """, (monitor_id, limit))
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_settings() -> Dict[str, str]:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT key, value FROM settings")
    rows = cursor.fetchall()
    conn.close()
    settings = {r["key"]: r["value"] for r in rows}

    # Allow cloud environment variables to provide default/fallback values
    if not settings.get("telegram_bot_token") and os.getenv("TELEGRAM_BOT_TOKEN"):
        settings["telegram_bot_token"] = os.getenv("TELEGRAM_BOT_TOKEN", DEFAULT_BOT_TOKEN)
    if not settings.get("telegram_chat_id") and os.getenv("TELEGRAM_CHAT_ID"):
        settings["telegram_chat_id"] = os.getenv("TELEGRAM_CHAT_ID")

    return settings


def update_setting(key: str, value: str):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", (key, value))
    conn.commit()
    conn.close()


def save_screen_layout(venue_code: str, screen_name: str, layout_data: Dict[str, Any]):
    """Persist a reference screen layout for future/unopened date preview."""
    if not venue_code or not screen_name or not layout_data:
        return
    conn = get_connection()
    cursor = conn.cursor()
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    clean_screen = screen_name.strip().upper()
    clean_venue = venue_code.strip().upper()
    layout_json = json.dumps(layout_data)
    cursor.execute("""
    INSERT OR REPLACE INTO screen_layouts (venue_code, screen_name, layout_json, updated_at)
    VALUES (?, ?, ?, ?)
    """, (clean_venue, clean_screen, layout_json, now_str))
    conn.commit()
    conn.close()


def get_screen_layout(venue_code: str, screen_name: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Retrieve saved reference screen layout for a cinema venue and screen."""
    if not venue_code:
        return None
    conn = get_connection()
    cursor = conn.cursor()
    clean_venue = venue_code.strip().upper()

    if screen_name and screen_name.strip():
        clean_screen = screen_name.strip().upper()
        cursor.execute(
            "SELECT layout_json, screen_name FROM screen_layouts WHERE venue_code = ? AND screen_name = ?",
            (clean_venue, clean_screen)
        )
        row = cursor.fetchone()
        if not row:
            # Fuzzy match e.g. "SCREEN 2" in screen_name
            cursor.execute(
                "SELECT layout_json, screen_name FROM screen_layouts WHERE venue_code = ? AND (screen_name LIKE ? OR ? LIKE '%' || screen_name || '%')",
                (clean_venue, f"%{clean_screen}%", clean_screen)
            )
            row = cursor.fetchone()
    else:
        cursor.execute(
            "SELECT layout_json, screen_name FROM screen_layouts WHERE venue_code = ? ORDER BY updated_at DESC LIMIT 1",
            (clean_venue,)
        )
        row = cursor.fetchone()

    conn.close()
    if row:
        try:
            d = json.loads(row["layout_json"])
            d["screen_name"] = row["screen_name"]
            return d
        except Exception:
            return None
    return None
