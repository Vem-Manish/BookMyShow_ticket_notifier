"""
SeatWatch Runner
Starts the FastAPI web server, background monitoring scheduler, and serves the UI.
"""

import os
import sys
import uvicorn

if __name__ == "__main__":
    # Ensure UTF-8 stdout encoding on Windows
    if sys.platform == "win32":
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except Exception:
            pass

    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "8000"))

    print("=" * 60)
    print("SeatWatch - BookMyShow Seat Availability Monitoring System")
    print("=" * 60)
    print(f"Web Dashboard live at: http://{host if host != '0.0.0.0' else '127.0.0.1'}:{port}")
    print("Background Monitoring Engine: ACTIVE")
    print("=" * 60)
    uvicorn.run("app.main:app", host=host, port=port, reload=False)
