"""
BookMyShow Live Data Client
Reverse-engineered TLS-impersonated interface to fetch regions, movies, cinemas, showtimes,
and decrypt real-time seat layouts.
"""

import base64
from datetime import datetime, timedelta
import json
import logging
import os
import re
from typing import Any, Dict, List, Optional
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
import primp

logger = logging.getLogger(__name__)

# Reverse-engineered AES-256 key from BMS frontend assets
BMS_AES_KEY = b"kYp3s6v9y$B&E)H+MbQeThWmZq4t7w!z"
BMS_AES_IV = b"\x00" * 16

DEFAULT_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://in.bookmyshow.com/",
}

POPULAR_CINEMAS_MAP = {
    "ALUC": "allu-cinemas-kokapet",
    "ACAS": "aaa-cinemas-ameerpet",
    "AMBH": "amb-cinemas-gachibowli",
    "PCMH": "pvr-central-mall-panjagutta",
    "INMH": "inox-gvk-one-mall-banjara-hills",
    "CLPH": "cinepolis-ccpl-mall-malkajgiri",
    "PVRH": "pvr-forum-sujana-mall-kukatpally",
    "PRSD": "prasads-multiplex-hyderabad",
    "INMC": "inox-gsm-mall-chandanagar",
    "PVIR": "pvr-irrum-manzil-hyderabad",
    "SMMR": "sandhya-70mm-4k-dolby-atmos-rtc-x-roads",
    "SUDA": "sudarshan-35mm-4k-laser-dolby-atmos-rtc-x-roads",
    "BRKH": "bhramaramba-70mm-a-c-4k-dolby-kukatpally",
    "ARJU": "arjun-70mm-kukatpally",
}


POPULAR_METROS = [
    {"code": "HYD", "name": "Hyderabad", "slug": "hyderabad"},
    {"code": "MUMBAI", "name": "Mumbai", "slug": "mumbai"},
    {"code": "NCR", "name": "Delhi-NCR", "slug": "national-capital-region-ncr"},
    {"code": "BANG", "name": "Bengaluru", "slug": "bengaluru"},
    {"code": "CHEN", "name": "Chennai", "slug": "chennai"},
    {"code": "PUNE", "name": "Pune", "slug": "pune"},
    {"code": "KOLK", "name": "Kolkata", "slug": "kolkata"},
    {"code": "AHD", "name": "Ahmedabad", "slug": "ahmedabad"},
    {"code": "CHD", "name": "Chandigarh", "slug": "chandigarh"},
    {"code": "KOCH", "name": "Kochi", "slug": "kochi"},
    {"code": "VIZAG", "name": "Visakhapatnam", "slug": "vizag"},
    {"code": "VIJ", "name": "Vijayawada", "slug": "vijayawada"},
    {"code": "COIM", "name": "Coimbatore", "slug": "coimbatore"},
    {"code": "JAIP", "name": "Jaipur", "slug": "jaipur"},
    {"code": "LUCK", "name": "Lucknow", "slug": "lucknow"},
    {"code": "SURAT", "name": "Surat", "slug": "surat"},
    {"code": "NAGP", "name": "Nagpur", "slug": "nagpur"},
    {"code": "IND", "name": "Indore", "slug": "indore"},
    {"code": "PAT", "name": "Patna", "slug": "patna"},
    {"code": "BHOP", "name": "Bhopal", "slug": "bhopal"},
    {"code": "VAD", "name": "Vadodara", "slug": "vadodara"},
    {"code": "LUDH", "name": "Ludhiana", "slug": "ludhiana"},
    {"code": "AGRA", "name": "Agra", "slug": "agra"},
    {"code": "NASH", "name": "Nashik", "slug": "nashik"},
    {"code": "RANC", "name": "Ranchi", "slug": "ranchi"},
    {"code": "VAR", "name": "Varanasi", "slug": "varanasi"},
    {"code": "AMR", "name": "Amritsar", "slug": "amritsar"},
    {"code": "ALLD", "name": "Prayagraj (Allahabad)", "slug": "prayagraj-allahabad"},
    {"code": "JAB", "name": "Jabalpur", "slug": "jabalpur"},
    {"code": "GWAL", "name": "Gwalior", "slug": "gwalior"},
    {"code": "AUR", "name": "Chhatrapati Sambhajinagar", "slug": "aurangabad"},
    {"code": "SOL", "name": "Solapur", "slug": "solapur"},
    {"code": "HUBL", "name": "Hubli-Dharwad", "slug": "hubli"},
    {"code": "MYSO", "name": "Mysuru (Mysore)", "slug": "mysore"},
    {"code": "TIRU", "name": "Tiruchirappalli", "slug": "trichy"},
    {"code": "MADU", "name": "Madurai", "slug": "madurai"},
    {"code": "SAL", "name": "Salem", "slug": "salem"},
    {"code": "KOTA", "name": "Kota", "slug": "kota"},
    {"code": "DEHR", "name": "Dehradun", "slug": "dehradun"},
    {"code": "TRIV", "name": "Thiruvananthapuram", "slug": "trivandrum"},
    {"code": "CAL", "name": "Kozhikode", "slug": "calicut"},
    {"code": "RAIP", "name": "Raipur", "slug": "raipur"},
    {"code": "GUW", "name": "Guwahati", "slug": "guwahati"},
    {"code": "BHUB", "name": "Bhubaneswar", "slug": "bhubaneswar"},
    {"code": "GOA", "name": "Goa", "slug": "goa"},
    {"code": "WAR", "name": "Warangal", "slug": "warangal"},
    {"code": "GUN", "name": "Guntur", "slug": "guntur"},
    {"code": "NELL", "name": "Nellore", "slug": "nellore"},
    {"code": "KURN", "name": "Kurnool", "slug": "kurnool"},
    {"code": "RAJ", "name": "Rajahmundry", "slug": "rajahmundry"},
    {"code": "KAK", "name": "Kakinada", "slug": "kakinada"},
    {"code": "TIRUP", "name": "Tirupati", "slug": "tirupati"},
    {"code": "KARI", "name": "Karimnagar", "slug": "karimnagar"},
    {"code": "NIZ", "name": "Nizamabad", "slug": "nizamabad"},
    {"code": "KHAM", "name": "Khammam", "slug": "khammam"},
]


class BMSClient:
    def __init__(self, browser_profile: str = "chrome"):
        self.browser_profile = browser_profile
        self.client = self._create_client()
        self._cinema_slug_cache: Dict[str, str] = dict(POPULAR_CINEMAS_MAP)
        self._cinema_format_cache: Dict[str, Dict[str, Any]] = {}

    def _create_client(self) -> primp.Client:
        proxy = os.getenv("BMS_PROXY") or os.getenv("HTTPS_PROXY") or os.getenv("HTTP_PROXY")
        client = None
        for prof in [self.browser_profile, "chrome", None]:
            try:
                kwargs = {"timeout": 12}
                if prof:
                    kwargs["impersonate"] = prof
                if proxy:
                    kwargs["proxy"] = proxy
                client = primp.Client(**kwargs)
                break
            except Exception:
                continue
        return client if client is not None else primp.Client(timeout=12)


    def get_regions(self) -> Dict[str, Any]:
        """Fetch list of supported cities/regions from BookMyShow with resilient fallback."""
        try:
            url = "https://in.bookmyshow.com/serv/getData?cmd=GETREGIONS"
            headers = dict(DEFAULT_HEADERS)
            headers["Referer"] = "https://in.bookmyshow.com/explore/home/hyderabad"
            res = self.client.get(url, headers=headers)
            if res.status_code == 200:
                m = re.search(r"var regionlst\s*=\s*(\{.*?\});", res.text)
                if m:
                    data = json.loads(m.group(1))
                    top_codes = ["HYD", "MUMBAI", "NCR", "BANG", "CHEN", "PUNE", "KOLK", "AHD", "CHD", "KOCH"]
                    popular_cities = []
                    all_cities = []
                    for code, entries in data.items():
                        if entries and isinstance(entries, list):
                            item = entries[0]
                            city_obj = {
                                "code": item.get("code", code),
                                "name": item.get("name", code.title()),
                                "slug": item.get("slug", code.lower()),
                            }
                            all_cities.append(city_obj)
                            if code in top_codes:
                                popular_cities.append(city_obj)
                    if all_cities:
                        popular_cities.sort(key=lambda x: top_codes.index(x["code"]) if x["code"] in top_codes else 999)
                        all_cities.sort(key=lambda x: x["name"])
                        return {"popular": popular_cities, "all": all_cities}
        except Exception as e:
            logger.warning(f"Error fetching live regions from BMS: {e}. Using resilient fallback catalog.")

        # Resilient offline/cloud fallback catalog
        top_10 = POPULAR_METROS[:10]
        sorted_all = sorted(POPULAR_METROS, key=lambda x: x["name"])
        return {
            "popular": top_10,
            "all": sorted_all
        }

    def get_movies(self, city_slug: str = "hyderabad") -> List[Dict[str, Any]]:
        """Fetch live movies playing or upcoming in a given city."""
        url = f"https://in.bookmyshow.com/explore/movies-{city_slug}"
        res = self.client.get(url, headers=DEFAULT_HEADERS)
        if res.status_code != 200:
            raise RuntimeError(f"Failed to fetch movies for {city_slug}: HTTP {res.status_code}")

        movies: List[Dict[str, Any]] = []

        # 1. Try application/ld+json schema extraction
        matches = re.findall(r'<script\s+type="application/ld\+json">(.*?)</script>', res.text, re.DOTALL)
        for m in matches:
            if "ItemList" in m:
                try:
                    data = json.loads(m)
                    for item in data.get("itemListElement", []):
                        item_url = item.get("url", "")
                        name = item.get("name", "")
                        # e.g., https://in.bookmyshow.com/hyderabad/movies/scene/ET00516631
                        parts = item_url.strip("/").split("/")
                        event_code = parts[-1] if parts and parts[-1].startswith("ET") else ""
                        movie_slug = parts[-2] if len(parts) >= 2 else name.lower().replace(" ", "-")

                        if name and event_code:
                            movies.append({
                                "title": name,
                                "slug": movie_slug,
                                "event_code": event_code,
                                "url": item_url
                            })
                except Exception as e:
                    logger.warning(f"Error parsing ld+json movies: {e}")

        # Deduplicate
        seen = set()
        unique_movies = []
        for m in movies:
            if m["event_code"] not in seen:
                seen.add(m["event_code"])
                unique_movies.append(m)

        return unique_movies

    def get_cinemas(self, city_slug: str = "hyderabad") -> List[Dict[str, Any]]:
        """Fetch all theatres / cinemas in a given city from BookMyShow."""
        url = f"https://in.bookmyshow.com/{city_slug}/cinemas"
        headers = dict(DEFAULT_HEADERS)
        headers["Referer"] = f"https://in.bookmyshow.com/explore/home/{city_slug}"
        res = self.client.get(url, headers=headers)
        if res.status_code != 200:
            # Fallback to explore URL
            res = self.client.get(f"https://in.bookmyshow.com/explore/cinemas-{city_slug}", headers=headers)
        if res.status_code != 200:
            raise RuntimeError(f"Failed to fetch cinemas for {city_slug}: HTTP {res.status_code}")

        idx = res.text.find("window.__INITIAL_STATE__ = ")
        if idx == -1:
            return []

        end_script = res.text.find("</script>", idx)
        script_text = res.text[idx + len("window.__INITIAL_STATE__ = "):end_script].strip().rstrip(";")

        try:
            state = json.loads(script_text)
        except Exception as e:
            logger.error(f"Error parsing cinemas JSON: {e}")
            return []

        f_venues = state.get("fetchVenuesListingApi", {})
        cinemas: List[Dict[str, Any]] = []

        for _, q_val in f_venues.get("queries", {}).items():
            d = q_val.get("data", {})
            for v in d.get("venues", []):
                v_name = v.get("VenueName", "")
                v_code = v.get("VenueCode", "")
                if not v_name or not v_code:
                    continue
                v_slug = re.sub(r"[^a-zA-Z0-9]+", "-", v_name.lower()).strip("-")
                self._cinema_slug_cache[v_code] = v_slug

                cinemas.append({
                    "name": v_name,
                    "code": v_code,
                    "slug": v_slug,
                    "address": v.get("VenueAddress", ""),
                })

        # Sort alphabetically
        cinemas.sort(key=lambda x: x["name"])
        return cinemas

    def _update_cinema_format_cache(self, venue_code: str, movies: List[Dict[str, Any]]):
        if venue_code not in self._cinema_format_cache:
            self._cinema_format_cache[venue_code] = {}
        store = self._cinema_format_cache[venue_code]

        for m in movies:
            title = m.get("title", "")
            if not title:
                continue
            if title not in store:
                store[title] = {
                    "title": title,
                    "group_id": m.get("group_id", ""),
                    "formats": {}
                }
            for f in m.get("formats", []):
                fname = f.get("format_name", "")
                if not fname or fname == "Any Format":
                    continue
                f_screens = f.get("screens", [])
                f_tags = f.get("tags", [])
                if fname not in store[title]["formats"]:
                    store[title]["formats"][fname] = {
                        "format_name": fname,
                        "language": f.get("language", ""),
                        "dimension": f.get("dimension", ""),
                        "event_code": f.get("event_code", ""),
                        "screen": f.get("screen", "SCREEN"),
                        "attributes": f.get("attributes", ""),
                        "screens": list(f_screens),
                        "tags": list(f_tags),
                        "is_predicted": True,
                        "shows": []
                    }
                else:
                    existing = store[title]["formats"][fname]
                    for sc in f_screens:
                        if sc and sc not in existing.setdefault("screens", []):
                            existing["screens"].append(sc)
                    for tg in f_tags:
                        if tg and tg not in existing.setdefault("tags", []):
                            existing["tags"].append(tg)

    def predict_cinema_formats(
        self,
        city_slug: str,
        venue_code: str,
        venue_slug: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """
        Synthesize which movies, screens, languages, and formats (Dolby 3D, 2D, 3D) are played at this cinema
        by scanning open dates (today through next 5 days).
        """
        store = self._cinema_format_cache.get(venue_code, {})
        has_rich_formats = any(len(m.get("formats", {})) >= 2 for m in store.values())

        if not has_rich_formats:
            today = datetime.now()
            for i in range(5):
                scan_date = (today + timedelta(days=i)).strftime("%Y%m%d")
                try:
                    raw = self.get_cinema_showtimes(
                        city_slug=city_slug,
                        venue_code=venue_code,
                        date_code=scan_date,
                        venue_slug=venue_slug,
                        include_predictions=False
                    )
                    if raw.get("is_open"):
                        self._update_cinema_format_cache(venue_code, raw.get("movies", []))
                except Exception as e:
                    logger.debug(f"Scan date {scan_date} exception: {e}")

        store = self._cinema_format_cache.get(venue_code, {})
        predicted_movies: List[Dict[str, Any]] = []

        for title, m in store.items():
            formats_list = list(m["formats"].values())

            # Sort formats so premium formats (DOLBY, IMAX, 3D) are displayed first
            def format_sort_key(x):
                fn = x.get("format_name", "").upper()
                at = x.get("attributes", "").upper()
                if "DOLBY" in fn or "DOLBY" in at:
                    return 0
                if "IMAX" in fn or "IMAX" in at:
                    return 1
                if "3D" in fn:
                    return 2
                return 3

            formats_list.sort(key=format_sort_key)

            # Add 'Any Format' option at the end
            formats_list.append({
                "format_name": "Any Format",
                "language": "Any",
                "dimension": "Any",
                "event_code": formats_list[0]["event_code"] if formats_list else "",
                "screen": "ANY SCREEN",
                "attributes": "Alert when any format opens",
                "screens": ["ANY SCREEN"],
                "tags": [],
                "is_predicted": True,
                "shows": []
            })

            predicted_movies.append({
                "title": title,
                "group_id": m.get("group_id", ""),
                "is_predicted": True,
                "formats": formats_list
            })

        # Fallback to city movies if cinema has no active schedule recorded
        if not predicted_movies:
            try:
                city_movies = self.get_movies(city_slug)
                for cm in city_movies:
                    predicted_movies.append({
                        "title": cm["title"],
                        "group_id": "",
                        "is_predicted": True,
                        "formats": [
                            {
                                "format_name": "Telugu • DOLBY CINEMA 3D",
                                "language": "Telugu",
                                "dimension": "DOLBY CINEMA 3D",
                                "event_code": cm.get("event_code", ""),
                                "screen": "SCREEN 1",
                                "attributes": "DOLBY CINEMA",
                                "screens": ["SCREEN 1"],
                                "tags": ["DOLBY CINEMA"],
                                "is_predicted": True,
                                "shows": []
                            },
                            {
                                "format_name": "Telugu • 3D",
                                "language": "Telugu",
                                "dimension": "3D",
                                "event_code": cm.get("event_code", ""),
                                "screen": "SCREEN 2",
                                "attributes": "LASER 4K ATMOS",
                                "screens": ["SCREEN 2"],
                                "tags": ["LASER 4K ATMOS", "PXL"],
                                "is_predicted": True,
                                "shows": []
                            },
                            {
                                "format_name": "Telugu • 2D",
                                "language": "Telugu",
                                "dimension": "2D",
                                "event_code": cm.get("event_code", ""),
                                "screen": "SCREEN 3",
                                "attributes": "Standard",
                                "screens": ["SCREEN 3"],
                                "tags": [],
                                "is_predicted": True,
                                "shows": []
                            },
                            {
                                "format_name": "Any Format",
                                "language": "Any",
                                "dimension": "Any",
                                "event_code": cm.get("event_code", ""),
                                "screen": "ANY SCREEN",
                                "attributes": "Alert when any format opens",
                                "screens": ["ANY SCREEN"],
                                "tags": [],
                                "is_predicted": True,
                                "shows": []
                            }
                        ]
                    })
            except Exception as e:
                logger.warning(f"Fallback to city movies failed: {e}")

        return predicted_movies

    def get_cinema_showtimes(
        self,
        city_slug: str,
        venue_code: str,
        date_code: str,
        venue_slug: Optional[str] = None,
        venue_name: Optional[str] = None,
        include_predictions: bool = True
    ) -> Dict[str, Any]:
        """
        Fetch ALL movies, screens, languages, and formats (Dolby 3D, 2D, 3D) for a specific cinema on a date.
        If the date has not opened yet and include_predictions is True, returns predicted formats & screens
        synthesized from the cinema's active schedule.
        """
        if not venue_slug:
            venue_slug = self._cinema_slug_cache.get(venue_code)
            if not venue_slug and venue_name:
                venue_slug = re.sub(r"[^a-zA-Z0-9]+", "-", venue_name.lower()).strip("-")
                self._cinema_slug_cache[venue_code] = venue_slug
            if not venue_slug:
                try:
                    all_cinemas = self.get_cinemas(city_slug)
                    for c in all_cinemas:
                        if c["code"] == venue_code:
                            venue_slug = c["slug"]
                            self._cinema_slug_cache[venue_code] = venue_slug
                            break
                except Exception:
                    pass
            if not venue_slug:
                venue_slug = f"cinema-{venue_code.lower()}"

        url = f"https://in.bookmyshow.com/cinemas/{city_slug}/{venue_slug}/buytickets/{venue_code}/{date_code}"
        headers = dict(DEFAULT_HEADERS)
        headers["Referer"] = f"https://in.bookmyshow.com/{city_slug}/cinemas"

        res = None
        for attempt in range(2):
            try:
                res = self.client.get(url, headers=headers)
                if res.status_code == 200:
                    break
                elif res.status_code in [403, 429, 503]:
                    logger.warning(f"BMS responded with HTTP {res.status_code} for {venue_code} on {date_code} (attempt {attempt+1}). Recreating client session...")
                    self.client = self._create_client()
            except Exception as e:
                logger.warning(f"BMS cinema request error on attempt {attempt+1}: {e}")
                self.client = self._create_client()

        result_movies: List[Dict[str, Any]] = []

        if res.status_code == 200:
            idx = res.text.find("window.__INITIAL_STATE__ = ")
            if idx != -1:
                end_script = res.text.find("</script>", idx)
                script_text = res.text[idx + len("window.__INITIAL_STATE__ = "):end_script].strip().rstrip(";")
                try:
                    data = json.loads(script_text)
                    v_func = data.get("venueShowtimesFunctionalApi", {})
                    query_key = f"getShowtimesByVenue-{venue_code}-{date_code}"
                    q_data = v_func.get("queries", {}).get(query_key, {}).get("data", {})
                    inner = q_data.get("data", {}) if "data" in q_data else q_data
                    sdt = inner.get("showDetailsTransformed", {})
                    events = sdt.get("Event", [])

                    for ev in events:
                        title = ev.get("EventTitle")
                        group_id = ev.get("EventGroup")
                        formats_list = []

                        for child in ev.get("ChildEvents", []):
                            lang = child.get("EventLanguage", "")
                            dim = child.get("EventDimension", "")
                            event_code = child.get("EventCode", "")
                            format_name = f"{lang} • {dim}".strip(" •")

                            shows = []
                            for st in child.get("ShowTimes", []):
                                session_id = str(st.get("SessionId", ""))
                                show_time = st.get("ShowTime", "")
                                screen = st.get("ScreenName", "")
                                attr = st.get("Attributes", "")
                                avail_status = str(st.get("AvailStatus", "1"))

                                booking_url = f"https://in.bookmyshow.com/booktickets/{venue_code}/{session_id}" if session_id else ""

                                shows.append({
                                    "session_id": session_id,
                                    "show_time": show_time,
                                    "screen": screen,
                                    "attributes": attr,
                                    "avail_status": avail_status,
                                    "booking_url": booking_url
                                })

                            unique_screens = list(dict.fromkeys([s["screen"] for s in shows if s.get("screen")]))
                            unique_tags = list(dict.fromkeys([s["attributes"] for s in shows if s.get("attributes")]))

                            formats_list.append({
                                "format_name": format_name,
                                "language": lang,
                                "dimension": dim,
                                "event_code": event_code,
                                "screen": shows[0]["screen"] if shows else "SCREEN",
                                "attributes": shows[0]["attributes"] if shows else "",
                                "screens": unique_screens,
                                "tags": unique_tags,
                                "is_predicted": False,
                                "shows": shows
                            })

                        result_movies.append({
                            "title": title,
                            "group_id": group_id,
                            "is_predicted": False,
                            "formats": formats_list
                        })
                except Exception as e:
                    logger.warning(f"Error parsing cinema showtimes: {e}")

        # If live shows exist on this date:
        if result_movies:
            self._update_cinema_format_cache(venue_code, result_movies)
            return {
                "is_open": True,
                "is_predicted": False,
                "venue_code": venue_code,
                "date_code": date_code,
                "movies": result_movies,
                "message": "Cinema showtimes live"
            }

        # Check if BMS was blocked / rate-limited
        if res and res.status_code in [403, 429, 503]:
            return {
                "is_open": False,
                "is_predicted": False,
                "is_error": True,
                "status_code": res.status_code,
                "venue_code": venue_code,
                "date_code": date_code,
                "movies": [],
                "message": f"BookMyShow rate-limited (HTTP {res.status_code}). Will retry on next radar check."
            }

        # If bookings are not open on this date:
        if not include_predictions:
            return {
                "is_open": False,
                "is_predicted": False,
                "venue_code": venue_code,
                "date_code": date_code,
                "movies": [],
                "message": f"Bookings not yet opened for {venue_code} on {date_code}."
            }

        # Predict formats based on cinema's active schedule
        predicted = self.predict_cinema_formats(city_slug, venue_code, venue_slug)
        return {
            "is_open": False,
            "is_predicted": True,
            "venue_code": venue_code,
            "date_code": date_code,
            "movies": predicted,
            "message": f"Bookings have not opened yet for this cinema on {date_code}. Showing predicted formats & screens from current schedule so you can set auto-alerts."
        }

    def get_theatres_and_showtimes(
        self,
        city_slug: str,
        movie_slug: str,
        event_code: str,
        city_code: str,
        date_code: str,
    ) -> Dict[str, Any]:
        """
        Fetch all theatres and showtimes for a movie.
        """
        url = f"https://in.bookmyshow.com/buytickets/{movie_slug}-{city_slug}/movie-{city_code.lower()}-{event_code}-MT/{date_code}"
        headers = dict(DEFAULT_HEADERS)
        headers["Referer"] = f"https://in.bookmyshow.com/explore/movies-{city_slug}"

        res = self.client.get(url, headers=headers)
        if res.status_code != 200:
            return {
                "is_open": False,
                "venues": [],
                "message": f"Showtimes page returned HTTP {res.status_code} (Bookings likely unopened)."
            }

        idx = res.text.find("window.__INITIAL_STATE__ = ")
        if idx == -1:
            return {
                "is_open": False,
                "venues": [],
                "message": "No booking state found (Show likely not scheduled yet)."
            }

        end_script = res.text.find("</script>", idx)
        script_text = res.text[idx + len("window.__INITIAL_STATE__ = "):end_script].strip()
        if script_text.endswith(";"):
            script_text = script_text[:-1]

        try:
            state = json.loads(script_text)
        except Exception as e:
            return {
                "is_open": False,
                "venues": [],
                "message": f"Error parsing BMS showtimes data: {e}"
            }

        s_func = state.get("showtimesFunctionalApi", {})
        queries = s_func.get("queries", {})
        
        dynamic_data = None
        for q_key, q_val in queries.items():
            if "fetchPrimaryDynamic" in q_key:
                dynamic_data = q_val.get("data", {}).get("data", {})
                break

        if not dynamic_data:
            return {
                "is_open": False,
                "venues": [],
                "message": "Bookings have not opened yet for this movie/theatre on this date."
            }

        widgets = dynamic_data.get("showtimeWidgets", [])
        venues_list: List[Dict[str, Any]] = []

        for widget in widgets:
            if widget.get("type") == "groupList":
                for group in widget.get("data", []):
                    for vcard in group.get("data", []):
                        add_data = vcard.get("additionalData", {})
                        venue_name = add_data.get("venueName")
                        venue_code = add_data.get("venueCode")
                        if not venue_code:
                            continue

                        venue_entry = {
                            "venue_name": venue_name,
                            "venue_code": venue_code,
                            "showtimes": []
                        }

                        for sec in vcard.get("showtimesSections", []):
                            for st in sec.get("showtimes", []):
                                cta_data = st.get("cta", {}).get("analytics", {})
                                add_st = st.get("additionalData", {})

                                # Strict date validation: BMS buytickets page defaults to today when a future date has not opened yet
                                show_date = str(add_st.get("showDateCode") or (add_st.get("showDateTime")[:8] if add_st.get("showDateTime") else "")).replace("-", "").strip()
                                norm_date = str(date_code).replace("-", "").strip()
                                if show_date and norm_date and show_date != norm_date:
                                    continue

                                session_id = add_st.get("sessionId") or cta_data.get("show_session_id")
                                show_time = st.get("title") or add_st.get("showTime")
                                screen_attr = st.get("screenAttr") or add_st.get("attributes", "")

                                booking_url = f"https://in.bookmyshow.com/booktickets/{venue_code}/{session_id}" if session_id else ""

                                venue_entry["showtimes"].append({
                                    "session_id": str(session_id),
                                    "show_time": show_time,
                                    "format": screen_attr or "Standard 2D",
                                    "screen_attr": screen_attr,
                                    "show_date": show_date or norm_date,
                                    "booking_url": booking_url
                                })

                        if venue_entry["showtimes"]:
                            venues_list.append(venue_entry)

        return {
            "is_open": len(venues_list) > 0,
            "venues": venues_list,
            "message": "Showtimes live" if venues_list else "No active showtimes found for this date."
        }

    def get_seat_layout(
        self,
        venue_code: str,
        session_id: str,
        region_code: str = "HYD",
        region_slug: str = "hyderabad"
    ) -> Dict[str, Any]:
        """
        Query BMS doTrans.aspx, decrypt AES-256-CBC payload, and parse exact seat statuses.
        """
        url = "https://services-in.bookmyshow.com/doTrans.aspx"
        headers = {
            "User-Agent": DEFAULT_HEADERS["User-Agent"],
            "Origin": "https://in.bookmyshow.com",
            "Referer": "https://in.bookmyshow.com/",
            "x-app-code": "WEB",
            "x-platform": "WEB",
            "x-platform-code": "WEB",
            "x-region-code": region_code,
            "x-region-slug": region_slug,
        }

        data = {
            "strAppCode": "WEB",
            "lngTransactionIdentifier": "0",
            "strCommand": "GETSEATLAYOUT",
            "strVenueCode": venue_code,
            "strParam1": str(session_id),
            "strParam2": "WEB",
            "strParam5": "Y",
            "strParam6": "N",
            "strParam7": "N",
            "strFormat": "json",
        }

        res = self.client.post(url, headers=headers, data=data)
        if res.status_code != 200:
            raise RuntimeError(f"Seat layout request failed: HTTP {res.status_code}")

        try:
            payload = res.json()
        except Exception as e:
            raise RuntimeError(f"Invalid JSON returned from doTrans: {e}")

        str_data = payload.get("BookMyShow", {}).get("strData")
        if not str_data:
            err_msg = payload.get("BookMyShow", {}).get("strException") or "Seat layout currently unavailable on BookMyShow (show may be sold out or unassigned)."
            return {
                "categories": [],
                "layout_rows": [],
                "rows": {},
                "all_seats": [],
                "available_seats": [],
                "total_seats": 0,
                "available_count": 0,
                "booked_count": 0,
                "message": err_msg
            }

        # Decrypt AES-256-CBC
        raw_ciphertext = base64.b64decode(str_data)
        cipher = Cipher(algorithms.AES(BMS_AES_KEY), modes.CBC(BMS_AES_IV), backend=default_backend())
        decryptor = cipher.decryptor()
        decrypted = decryptor.update(raw_ciphertext) + decryptor.finalize()

        # Remove PKCS7 padding
        pad_len = decrypted[-1]
        if pad_len < 16:
            decrypted = decrypted[:-pad_len]

        decrypted_text = decrypted.decode("utf-8", errors="ignore")
        return self._parse_decrypted_seat_layout(decrypted_text)

    def _parse_decrypted_seat_layout(self, raw_layout: str) -> Dict[str, Any]:
        """
        Parses decrypted layout text format:
        [CATEGORIES] || [ROWS_AND_SEATS]
        Preserves all aisles, gaps, and horizontal walkways exactly as structured in BookMyShow.
        """
        parts = raw_layout.split("||")
        categories_str = parts[0]
        rows_str = parts[1] if len(parts) > 1 else ""

        category_map: Dict[str, str] = {}
        categories = []
        for cat in categories_str.split("|"):
            if cat.strip():
                c_parts = cat.split(":")
                c_name = c_parts[0]
                c_code = c_parts[1] if len(c_parts) > 1 else ""
                c_price = c_parts[2] if len(c_parts) > 2 else ""
                cat_obj = {
                    "name": c_name,
                    "code": c_code,
                    "price_code": c_price
                }
                categories.append(cat_obj)
                if c_code:
                    category_map[c_code] = c_name

        layout_rows = []
        rows_dict: Dict[str, List[Dict[str, Any]]] = {}
        all_seats: List[Dict[str, Any]] = []
        available_seats: List[str] = []

        for row_block in rows_str.split("|"):
            if not row_block.strip():
                continue
            tokens = row_block.split(":")
            if len(tokens) < 3:
                continue

            phy_row = tokens[1].strip()
            seat_tokens = tokens[2:]

            # Check if this is a horizontal walkway aisle row
            if not phy_row or phy_row == "-":
                layout_rows.append({
                    "is_walkway": True,
                    "row_label": "",
                    "category": "",
                    "grid_items": []
                })
                continue

            grid_items = []
            row_category = ""

            for st in seat_tokens:
                st = st.strip()
                if not st:
                    continue

                if "+" in st:
                    # Multiplex format 1 (e.g. ALLU Cinemas): code + display_number (A201+01)
                    p = st.split("+")
                    code = p[0]
                    disp_num = p[1]
                    area_id = code[0] if len(code) > 0 else ""
                    status_char = code[1] if len(code) > 1 else "0"
                else:
                    # Multiplex format 2 (e.g. PVR, INOX, Cinepolis): area + status + seat_num (A000, A201, B105)
                    if len(st) < 2:
                        continue
                    area_id = st[0]
                    status_char = st[1]
                    disp_num = st[2:] if len(st) > 2 else ""

                if area_id and area_id in category_map and not row_category:
                    row_category = category_map[area_id]

                # status_char: 0 = gap/empty aisle space, 1 = available, 2 = booked
                if status_char == "0" or disp_num in ["00", "0", ""]:
                    grid_items.append({
                        "is_seat": False,
                        "is_gap": True,
                        "display": ""
                    })
                else:
                    is_avail = (status_char == "1")
                    seat_num = int(disp_num) if disp_num.isdigit() else 0
                    seat_id = f"{phy_row}{seat_num}"

                    seat_obj = {
                        "is_seat": True,
                        "is_gap": False,
                        "seat_id": seat_id,
                        "row": phy_row,
                        "number": seat_num,
                        "display_number": str(int(disp_num)) if disp_num.isdigit() else disp_num,
                        "status": "AVAILABLE" if is_avail else "BOOKED",
                        "is_available": is_avail,
                        "area_code": area_id,
                        "category": category_map.get(area_id, row_category or "STANDARD")
                    }

                    grid_items.append(seat_obj)
                    all_seats.append(seat_obj)

                    if phy_row not in rows_dict:
                        rows_dict[phy_row] = []
                    rows_dict[phy_row].append(seat_obj)

                    if is_avail:
                        available_seats.append(seat_id)

            layout_rows.append({
                "is_walkway": False,
                "row_label": phy_row,
                "category": row_category,
                "grid_items": grid_items
            })

        return {
            "categories": categories,
            "layout_rows": layout_rows,
            "rows": rows_dict,
            "all_seats": all_seats,
            "available_seats": sorted(available_seats),
            "total_seats": len(all_seats),
            "available_count": len(available_seats),
            "booked_count": len(all_seats) - len(available_seats)
        }

    def get_reference_layout(
        self,
        venue_code: str,
        screen_name: Optional[str] = None,
        city_slug: str = "hyderabad"
    ) -> Dict[str, Any]:
        """
        Retrieve a reference seat layout for a screen at a cinema venue.
        If a future show has not opened yet, this reference layout lets the user view the exact
        seat configuration (rows, walkways, aisle gaps) and set their monitoring zone.
        """
        from app.database import get_screen_layout, save_screen_layout

        clean_venue = venue_code.strip().upper()
        clean_screen = (screen_name or "").strip().upper()

        # 1. Check saved layout in database
        saved = get_screen_layout(clean_venue, clean_screen)
        if saved and saved.get("layout_rows"):
            saved["is_reference"] = True
            saved["reference_note"] = f"Reference layout for {saved.get('screen_name', clean_screen or 'Screen')}"
            return saved

        # 2. If not saved, scan active showtimes for this cinema today/tomorrow to find an open session
        today = datetime.now()
        for day_offset in range(4):
            scan_date = (today + timedelta(days=day_offset)).strftime("%Y%m%d")
            try:
                c_data = self.get_cinema_showtimes(
                    city_slug=city_slug,
                    venue_code=clean_venue,
                    date_code=scan_date,
                    include_predictions=False
                )
                if not c_data.get("is_open"):
                    continue

                for m in c_data.get("movies", []):
                    for f in m.get("formats", []):
                        f_screen = (f.get("screen") or "").strip().upper()
                        is_match = (not clean_screen) or (clean_screen in f_screen) or (f_screen in clean_screen)
                        for s in f.get("shows", []):
                            sid = s.get("session_id")
                            if not sid:
                                continue
                            try:
                                layout = self.get_seat_layout(clean_venue, sid)
                                if layout.get("total_seats", 0) > 0 and layout.get("layout_rows"):
                                    assigned_screen = f_screen or clean_screen or "SCREEN"
                                    save_screen_layout(clean_venue, assigned_screen, layout)
                                    if is_match:
                                        layout["is_reference"] = True
                                        layout["screen_name"] = assigned_screen
                                        layout["reference_note"] = f"Reference layout for {assigned_screen}"
                                        return layout
                            except Exception:
                                continue
            except Exception:
                continue

        # 3. Check DB again in case an alternative screen was saved during scan
        fallback = get_screen_layout(clean_venue)
        if fallback and fallback.get("layout_rows"):
            fallback["is_reference"] = True
            fallback["reference_note"] = f"Reference layout for {fallback.get('screen_name', 'Cinema Screen')}"
            return fallback

        # 4. Fallback if no shows exist at all
        return {
            "categories": [],
            "layout_rows": [],
            "rows": {},
            "all_seats": [],
            "available_seats": [],
            "total_seats": 0,
            "available_count": 0,
            "booked_count": 0,
            "is_reference": True,
            "message": f"Reference layout for {clean_screen or 'this screen'} will be captured as soon as shows appear on BMS."
        }
