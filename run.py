"""
SeatWatch Runner
Starts the FastAPI web server, background monitoring scheduler, and serves the UI.
"""

import sys
import uvicorn

if __name__ == "__main__":
    # Ensure UTF-8 stdout encoding on Windows
    if sys.platform == "win32":
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except Exception:
            pass

    print("=" * 60)
    print("SeatWatch - BookMyShow Seat Availability Monitoring System")
    print("=" * 60)
    print("Web Dashboard live at: http://127.0.0.1:8000")
    print("Background Monitoring Engine: ACTIVE")
    print("=" * 60)
    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, reload=False)

