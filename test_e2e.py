"""
End-to-End Test Suite for SeatWatch
Verifies database initialization, BMS client calls, rule evaluation,
scheduler check execution, and FastAPI REST endpoints.
"""

import sys
import unittest
from fastapi.testclient import TestClient

from app.bms_client import BMSClient
from app.database import (
    create_monitor,
    delete_monitor,
    get_all_monitors,
    get_logs,
    get_monitor_by_id,
    init_db,
)
from app.main import app
from app.rules import RuleEvaluator
from app.scheduler import scheduler_instance


class TestSeatWatchSystem(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        init_db()
        cls.client = TestClient(app)
        cls.bms = BMSClient()

    def test_01_regions_discovery(self):
        response = self.client.get("/api/regions")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("popular", data)
        self.assertIn("all", data)
        codes = [c["code"] for c in data["popular"]]
        self.assertIn("HYD", codes)
        print("[OK] Regions Discovery verified.")

    def test_02_movies_discovery(self):
        response = self.client.get("/api/movies?city_slug=hyderabad")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("movies", data)
        self.assertGreater(len(data["movies"]), 0)
        print(f"[OK] Movies Discovery verified ({len(data['movies'])} movies found).")

    def test_03_seat_layout_decryption(self):
        # Test with live session at AAA Cinemas Ameerpet (session 39838)
        layout = self.bms.get_seat_layout("ACAS", "39838")
        if not layout or layout.get("total_seats", 0) == 0:
            layout = self.bms.get_seat_layout("ALUC", "6330")
        self.assertIn("total_seats", layout)
        self.assertIn("available_seats", layout)
        self.assertIn("layout_rows", layout)
        self.assertGreater(layout["total_seats"], 0)
        # Check walkways and aisle gaps are parsed properly
        has_walkways = any(r.get("is_walkway") for r in layout["layout_rows"])
        has_gaps = any(any(item.get("is_gap") for item in r.get("grid_items", [])) for r in layout["layout_rows"] if not r.get("is_walkway"))
        self.assertTrue(has_walkways, "Horizontal walkways should be detected in layout")
        self.assertTrue(has_gaps, "Aisle gaps between seat blocks should be detected in layout")
        print(f"[OK] BMS AES-256 Layout Decryption verified ({layout['total_seats']} seats parsed, {layout['available_count']} open, walkways & aisles preserved).")

    def test_04_rule_evaluator(self):
        dummy_layout = {
            "available_seats": ["G10", "G11", "G12", "H5", "H6"],
            "rows": {
                "G": [
                    {"seat_id": "G10", "number": 10, "is_available": True},
                    {"seat_id": "G11", "number": 11, "is_available": True},
                    {"seat_id": "G12", "number": 12, "is_available": True},
                    {"seat_id": "G13", "number": 13, "is_available": False},
                ]
            },
            "all_seats": [],
            "available_count": 5
        }

        # Exact rule match
        sat, matched, _ = RuleEvaluator.evaluate("EXACT", {"seats": ["G10", "G11"], "match_mode": "ALL"}, dummy_layout)
        self.assertTrue(sat)
        self.assertEqual(matched, ["G10", "G11"])

        # Range rule match
        sat, matched, _ = RuleEvaluator.evaluate("RANGE", {"row": "G", "start": 10, "end": 20, "min_seats": 2}, dummy_layout)
        self.assertTrue(sat)
        self.assertIn("G10", matched)

        # Consecutive rule match
        sat, matched, _ = RuleEvaluator.evaluate("CONSECUTIVE", {"row": "G", "count": 3}, dummy_layout)
        self.assertTrue(sat)
        self.assertEqual(matched, ["G10", "G11", "G12"])

        # Multi-Row Zone Match: Rows B to I, Seats 10 to 20, 3 consecutive seats
        zone_payload = {
            "row_start": "B",
            "row_end": "I",
            "seat_min": 10,
            "seat_max": 20,
            "quantity": 3,
            "consecutive": True
        }
        sat_z, matched_z, _ = RuleEvaluator.evaluate("ZONES", zone_payload, dummy_layout)
        self.assertTrue(sat_z)
        self.assertEqual(matched_z, ["G10", "G11", "G12"])

        # Multi-Zone Selection: Selection 1 (Middle rows B-I) OR Selection 2 (Row J 1-10)
        multi_zone_payload = {
            "match_logic": "ANY",
            "zones": [
                {
                    "title": "Middle Rows (B-I, 10-20)",
                    "row_start": "B",
                    "row_end": "I",
                    "seat_min": 10,
                    "seat_max": 20,
                    "quantity": 3,
                    "consecutive": True
                },
                {
                    "title": "Row J (1-10)",
                    "row_start": "J",
                    "row_end": "J",
                    "seat_min": 1,
                    "seat_max": 10,
                    "quantity": 2,
                    "consecutive": True
                }
            ]
        }
        sat_mz, matched_mz, _ = RuleEvaluator.evaluate("ZONES", multi_zone_payload, dummy_layout)
        self.assertTrue(sat_mz)
        self.assertEqual(matched_mz, ["G10", "G11", "G12"])
        self.assertTrue(sat)
        self.assertEqual(matched, ["G10", "G11", "G12"])

        print("[OK] Rule Evaluator conditions verified.")

    def test_05_monitor_lifecycle_and_check(self):
        # Create a test monitor
        monitor_id = create_monitor({
            "title": "Test Watch - AAA Cinemas",
            "city_code": "HYD",
            "city_slug": "hyderabad",
            "movie_title": "Scene",
            "movie_slug": "scene",
            "event_code": "ET00516631",
            "venue_name": "AAA Cinemas: Ameerpet",
            "venue_code": "ACAS",
            "target_date": "20261106",
            "format_filter": "",
            "session_id": "39831",
            "rule_type": "RANGE",
            "rule_payload": {"row": "K", "start": 8, "end": 12, "min_seats": 1},
            "interval_minutes": 2.0
        })

        self.assertIsNotNone(monitor_id)
        monitor = get_monitor_by_id(monitor_id)
        self.assertEqual(monitor["venue_code"], "ACAS")

        # Test trigger check via REST API
        resp = self.client.post(f"/api/monitors/{monitor_id}/check_now")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn(data["status"], ["TRIGGERED", "ACTIVE"])

        # Check logs
        logs = get_logs(monitor_id)
        self.assertGreater(len(logs), 0)

        # Clean up
        delete_monitor(monitor_id)
        print("[OK] Monitor creation, live check execution, and DB logging verified.")

    def test_06_frontend_served(self):
        resp = self.client.get("/")
        self.assertEqual(resp.status_code, 200)
        self.assertIn(b"SeatWatch", resp.content)
        print("[OK] Frontend HTML delivery verified.")

    def test_07_cinema_showtimes_and_child_formats(self):
        # Verify that querying cinema showtimes returns ChildEvents (Dolby 3D, 2D, 3D, etc.)
        data = self.bms.get_cinema_showtimes("hyderabad", "ALUC", "20261108", venue_slug="allu-cinemas-kokapet")
        self.assertTrue(data.get("is_open"))
        movies = data.get("movies", [])
        self.assertGreater(len(movies), 0)

        ramayana = next((m for m in movies if "ramayana" in m["title"].lower()), None)
        self.assertIsNotNone(ramayana, "Ramayana should be present in ALUC on 20261108")
        formats = [f["format_name"] for f in ramayana["formats"]]
        # Must contain multiple formats (Dolby Cinema 3D, 3D, 2D)
        self.assertGreater(len(formats), 1)
        print(f"[OK] Cinema ChildEvents verified for {ramayana['title']}: {len(formats)} formats found ({', '.join(formats)}).")

    def test_08_predicted_formats_on_unopened_date(self):
        # Verify that querying an unopened future date (e.g. 20261114) returns predicted formats (Dolby Cinema 3D, etc.)
        data = self.bms.get_cinema_showtimes("hyderabad", "ALUC", "20261114", venue_slug="allu-cinemas-kokapet")
        self.assertFalse(data.get("is_open"))
        self.assertTrue(data.get("is_predicted"))
        movies = data.get("movies", [])
        self.assertGreater(len(movies), 0)

        ramayana = next((m for m in movies if "ramayana" in m["title"].lower()), None)
        self.assertIsNotNone(ramayana, "Ramayana should be predicted for ALUC on 20261114")
        formats = [f["format_name"] for f in ramayana["formats"]]
        self.assertIn("Telugu • DOLBY CINEMA 3D", formats)
        print(f"[OK] Predicted formats on unopened future date verified: found {', '.join(formats)}.")

    def test_09_reference_layout_endpoint(self):
        # Verify reference layout API returns rows and aisles even for unopened shows
        response = self.client.get("/api/reference_layout?venue_code=ALUC&screen=SCREEN%202")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("layout_rows", data)
        self.assertGreater(len(data["layout_rows"]), 0)
        self.assertTrue(data.get("is_reference"))
        print(f"[OK] Reference layout verified for SCREEN 2 ({len(data['layout_rows'])} rows, is_reference=True).")

    def test_10_pvr_layout_and_screen_tags(self):
        # Verify PVR Lakeshore ILKS has PXL screen tags and seat layout parses correctly
        data = self.bms.get_cinema_showtimes("hyderabad", "ILKS", "20261108")
        self.assertTrue(data.get("is_open"))
        ramayana = next((m for m in data.get("movies", []) if "ramayana" in m["title"].lower()), None)
        self.assertIsNotNone(ramayana, "Ramayana should be at ILKS")

        telugu_3d = next((f for f in ramayana["formats"] if "telugu" in f["format_name"].lower() and "3d" in f["format_name"].lower()), None)
        self.assertIsNotNone(telugu_3d, "Telugu 3D should exist at ILKS")

        # Verify PXL tag is present
        self.assertIn("PXL", telugu_3d.get("tags", []))
        pxl_shows = [s for s in telugu_3d["shows"] if s.get("attributes") == "PXL"]
        self.assertGreaterEqual(len(pxl_shows), 2, "Should have at least 2 PXL shows")

        # Test PVR seat layout parsing for session 13529
        layout = self.bms.get_seat_layout("ILKS", "13529")
        self.assertGreater(layout.get("total_seats", 0), 200, "PVR ILKS should parse > 200 seats")
        self.assertGreater(len(layout.get("layout_rows", [])), 10, "PVR ILKS should have > 10 rows")
        print(f"[OK] PVR Layout & Screen Tags verified: {len(pxl_shows)} PXL shows found, layout parsed {layout['total_seats']} seats.")

    def test_11_screen_filter_scheduler(self):
        # Test monitor with PXL screen filter
        monitor_id = create_monitor({
            "title": "Ramayana (Telugu • 3D • [PXL]) - PVR Lakeshore",
            "city_code": "HYD",
            "city_slug": "hyderabad",
            "movie_title": "Ramayana",
            "movie_slug": "ramayana",
            "event_code": "ET00414436",
            "venue_name": "PVR: Lakeshore, Hyderabad",
            "venue_code": "ILKS",
            "target_date": "20261108",
            "format_filter": "Telugu • 3D",
            "session_id": "ALL",
            "rule_type": "ZONES",
            "rule_payload": {
                "screen_filter": "PXL",
                "match_logic": "ANY",
                "zones": [{
                    "row_start": "B",
                    "row_end": "I",
                    "seat_min": 12,
                    "seat_max": 25,
                    "quantity": 2,
                    "consecutive": True
                }]
            },
            "interval_minutes": 2.0
        })

        import asyncio
        res = asyncio.run(scheduler_instance.execute_check(monitor_id))
        self.assertIn(res["status"], ["TRIGGERED", "ACTIVE", "WAITING"])
        delete_monitor(monitor_id)
        print(f"[OK] Screen filter scheduling verified (status: {res.get('status')}).")

    def test_12_soldout_fallback(self):
        # Test /api/seats with sold out / unavailable session falls back to reference layout
        resp = self.client.get("/api/seats?venue_code=AMBH&session_id=999999&region_code=HYD&region_slug=hyderabad&screen=SCREEN%205")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertGreater(data.get("total_seats", 0), 0)
        self.assertTrue(data.get("is_sold_out") or data.get("is_reference"))
        print(f"[OK] Sold-out reference layout fallback verified: {data['total_seats']} seats loaded.")


    def test_13_telegram_1click_pairing(self):
        # 1. Generate pairing code
        res = self.client.get("/api/telegram/pair_code")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data.get("success"))
        code = data.get("code")
        self.assertTrue(code.startswith("sw_"))
        self.assertIn("deep_link", data)
        self.assertIn(code, data["deep_link"])

        # 2. Check initial pending status
        status_res = self.client.get(f"/api/telegram/pair_status?code={code}")
        self.assertEqual(status_res.status_code, 200)
        status_data = status_res.json()
        self.assertEqual(status_data.get("status"), "PENDING")

        print("[OK] Telegram 1-click deep-link pairing endpoints verified.")


    def test_14_telegram_isolation_and_gating(self):
        # 1. Attempt to create a monitor without Telegram Chat ID -> Must fail with 400
        req_without_tg = {
            "title": "Ungated Watch",
            "city_code": "HYD",
            "city_slug": "hyderabad",
            "movie_title": "Ramayana",
            "movie_slug": "ramayana",
            "event_code": "ET00523252",
            "venue_name": "ALLU Cinemas: Kokapet",
            "venue_code": "ALUC",
            "target_date": "20261110",
            "format_filter": "Telugu • DOLBY CINEMA 3D",
            "session_id": "ALL",
            "rule_type": "BOOKING_OPEN",
            "rule_payload": {}
        }
        res_fail = self.client.post("/api/monitors", json=req_without_tg)
        self.assertEqual(res_fail.status_code, 400)
        self.assertIn("connected Telegram account", res_fail.json()["detail"])

        # 2. Create monitor for User A (Chat ID: 111111)
        req_user_a = dict(req_without_tg)
        req_user_a["rule_payload"] = {"telegram_chat_id": "111111"}
        res_a = self.client.post("/api/monitors", json=req_user_a)
        self.assertEqual(res_a.status_code, 200)
        mon_a_id = res_a.json()["monitor_id"]

        # 3. Create monitor for User B (Chat ID: 222222)
        req_user_b = dict(req_without_tg)
        req_user_b["rule_payload"] = {"telegram_chat_id": "222222"}
        res_b = self.client.post("/api/monitors", json=req_user_b)
        self.assertEqual(res_b.status_code, 200)
        mon_b_id = res_b.json()["monitor_id"]

        # 4. User A queries monitors -> Must see ONLY User A's monitors
        res_list_a = self.client.get("/api/monitors?telegram_chat_id=111111")
        self.assertEqual(res_list_a.status_code, 200)
        ids_a = [m["id"] for m in res_list_a.json()]
        self.assertIn(mon_a_id, ids_a)
        self.assertNotIn(mon_b_id, ids_a)

        # 5. User B queries monitors -> Must see ONLY User B's monitors
        res_list_b = self.client.get("/api/monitors?telegram_chat_id=222222")
        self.assertEqual(res_list_b.status_code, 200)
        ids_b = [m["id"] for m in res_list_b.json()]
        self.assertIn(mon_b_id, ids_b)
        self.assertNotIn(mon_a_id, ids_b)

        # Clean up
        self.client.delete(f"/api/monitors/{mon_a_id}")
        self.client.delete(f"/api/monitors/{mon_b_id}")
        print("[OK] Telegram watcher creation gating & multi-user isolation verified.")


if __name__ == "__main__":
    unittest.main()
