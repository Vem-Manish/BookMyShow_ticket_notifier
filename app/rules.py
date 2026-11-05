"""
Seat Availability Rule Evaluator
Handles Exact seats, Multi-Row/Seat-Range Zones with Consecutive options,
Multi-Zone Selection (OR/AND logic), and Category checks.
"""

import re
from typing import Any, Dict, List, Optional, Set, Tuple


def expand_rows(
    row_spec: Any = None,
    start_row: Optional[str] = None,
    end_row: Optional[str] = None,
    known_rows: Optional[List[str]] = None
) -> List[str]:
    """
    Expands row specifications into a list of row letters.
    Supports:
      - start_row="B", end_row="I" -> ["B", "C", "D", "E", "F", "G", "H", "I"]
      - row_spec="B-I" or "B to I" -> ["B", "C", "D", "E", "F", "G", "H", "I"]
      - row_spec="B,C,D,E,F,G,H,I" -> ["B", "C", "D", "E", "F", "G", "H", "I"]
      - row_spec=["B", "C", "D"] -> ["B", "C", "D"]
    """
    res: List[str] = []

    # Priority 1: explicit start_row and end_row
    if start_row and end_row:
        s = start_row.strip().upper()
        e = end_row.strip().upper()
        if len(s) == 1 and len(e) == 1 and s.isalpha() and e.isalpha():
            start_ord = ord(s)
            end_ord = ord(e)
            if start_ord <= end_ord:
                res = [chr(c) for c in range(start_ord, end_ord + 1)]
            else:
                res = [chr(c) for c in range(end_ord, start_ord + 1)]
        elif s == e:
            res = [s]

    # Priority 2: row_spec string or list
    if not res and row_spec:
        if isinstance(row_spec, list):
            res = [str(r).strip().upper() for r in row_spec if str(r).strip()]
        elif isinstance(row_spec, str):
            clean = row_spec.strip().upper()
            if "-" in clean:
                parts = clean.split("-")
                return expand_rows(start_row=parts[0].strip(), end_row=parts[1].strip(), known_rows=known_rows)
            elif " TO " in clean:
                parts = clean.split(" TO ")
                return expand_rows(start_row=parts[0].strip(), end_row=parts[1].strip(), known_rows=known_rows)
            elif "," in clean:
                res = [p.strip() for p in clean.split(",") if p.strip()]
            elif clean:
                res = [clean]

    # Intersect with known screen rows if available to preserve physical order & filter valid rows
    if known_rows and res:
        known_upper = [k.upper() for k in known_rows]
        filtered = [r for r in res if r in known_upper]
        if filtered:
            return filtered

    return res if res else ["G"]


class RuleEvaluator:
    @staticmethod
    def evaluate(
        rule_type: str,
        rule_payload: Dict[str, Any],
        seat_data: Dict[str, Any]
    ) -> Tuple[bool, List[str], str]:
        """
        Evaluates conditions against seat layout data.
        Returns: (is_satisfied: bool, matched_seats: List[str], explanation: str)
        """
        rule_type = (rule_type or "").upper()

        if rule_type == "BOOKING_OPEN":
            avail_count = seat_data.get("available_count", 0)
            return True, seat_data.get("available_seats", [])[:5], f"Booking is OPEN! {avail_count} seats available."

        # Check for multi-zone rule payload
        if "zones" in rule_payload or rule_type in ["ZONES", "MULTI_ZONE", "ZONE"]:
            return RuleEvaluator.evaluate_multi_zone(rule_payload, seat_data)

        # Legacy EXACT rule
        if rule_type == "EXACT":
            available_seats_set: Set[str] = set(seat_data.get("available_seats", []))
            targets = [s.strip().upper() for s in rule_payload.get("seats", [])]
            match_mode = rule_payload.get("match_mode", "ALL").upper()

            matched = [s for s in targets if s in available_seats_set]
            if match_mode == "ALL":
                is_satisfied = (len(matched) == len(targets)) and len(targets) > 0
                msg = (
                    f"All preferred seats ({', '.join(targets)}) are available!"
                    if is_satisfied else
                    f"Only {len(matched)}/{len(targets)} seats available: {', '.join(matched)}"
                )
            else:
                min_count = int(rule_payload.get("min_count", 1))
                is_satisfied = len(matched) >= min_count
                msg = (
                    f"{len(matched)} matching seats available: {', '.join(matched)}"
                    if is_satisfied else
                    f"Not enough seats found. Required: {min_count}, Found: {len(matched)}"
                )
            return is_satisfied, matched, msg

        # Legacy / Single Zone RANGE rule
        if rule_type == "RANGE":
            # If payload contains multiple rows or consecutive flag, evaluate via single zone
            if (
                rule_payload.get("row_start")
                or rule_payload.get("start_row")
                or "," in str(rule_payload.get("row", ""))
                or "-" in str(rule_payload.get("row", ""))
                or rule_payload.get("consecutive")
            ):
                return RuleEvaluator.evaluate_single_zone(rule_payload, seat_data)

            available_seats_set = set(seat_data.get("available_seats", []))
            row = rule_payload.get("row", "").strip().upper()
            start = int(rule_payload.get("start", rule_payload.get("seat_min", 1)))
            end = int(rule_payload.get("end", rule_payload.get("seat_max", 999)))
            min_seats = int(rule_payload.get("min_seats", rule_payload.get("quantity", 1)))

            target_seats = [f"{row}{num}" for num in range(start, end + 1)]
            matched = [s for s in target_seats if s in available_seats_set]

            is_satisfied = len(matched) >= min_seats
            msg = (
                f"Found {len(matched)} seats in Row {row} (Seats {start}-{end}): {', '.join(matched)}"
                if is_satisfied else
                f"Found {len(matched)} seats in Row {row} range, needs at least {min_seats}"
            )
            return is_satisfied, matched, msg

        # Legacy CONSECUTIVE rule
        if rule_type == "CONSECUTIVE":
            if (
                rule_payload.get("row_start")
                or rule_payload.get("start_row")
                or "," in str(rule_payload.get("row", ""))
                or "-" in str(rule_payload.get("row", ""))
            ):
                return RuleEvaluator.evaluate_single_zone(rule_payload, seat_data)

            count = int(rule_payload.get("count", rule_payload.get("quantity", 2)))
            target_row = rule_payload.get("row", "").strip().upper()

            rows_dict = seat_data.get("rows", {})
            rows_to_check = [target_row] if target_row and target_row in rows_dict else list(rows_dict.keys())

            best_match: List[str] = []

            for r in rows_to_check:
                seats_in_row = sorted(
                    [s for s in rows_dict[r] if s["is_available"]],
                    key=lambda x: x["number"]
                )
                nums = [s["number"] for s in seats_in_row]

                for i in range(len(nums) - count + 1):
                    window = nums[i:i + count]
                    if window == list(range(window[0], window[0] + count)):
                        best_match = [f"{r}{num}" for num in window]
                        break
                if best_match:
                    break

            is_satisfied = len(best_match) == count
            msg = (
                f"Found {count} consecutive seats: {', '.join(best_match)}"
                if is_satisfied else
                f"No sequence of {count} consecutive seats currently open."
            )
            return is_satisfied, best_match, msg

        # Legacy CATEGORY rule
        if rule_type == "CATEGORY":
            cat_name = rule_payload.get("category", "").strip().lower()
            min_seats = int(rule_payload.get("min_seats", 1))

            matched_area_codes = [
                c.get("area_code") for c in seat_data.get("categories", [])
                if cat_name in c.get("name", "").lower()
            ]

            all_seats = seat_data.get("all_seats", [])
            matched = [
                s["seat_id"] for s in all_seats
                if s["is_available"] and s.get("area_code") in matched_area_codes
            ]

            is_satisfied = len(matched) >= min_seats
            msg = (
                f"Found {len(matched)} available seats in category '{cat_name}': {', '.join(matched[:10])}"
                if is_satisfied else
                f"Only {len(matched)} seats available in '{cat_name}' (required {min_seats})"
            )
            return is_satisfied, matched, msg

        return False, [], "Unknown rule type"

    @staticmethod
    def evaluate_multi_zone(
        rule_payload: Dict[str, Any],
        seat_data: Dict[str, Any]
    ) -> Tuple[bool, List[str], str]:
        """
        Evaluates multiple seat zones/selections (e.g. Selection 1: B-I 12-25, 4 consecutive seats;
        Selection 2: Row J 1-10, 2 seats).
        Supports match_logic="ANY" (OR) or match_logic="ALL" (AND).
        """
        zones = rule_payload.get("zones", [])
        if not zones:
            # Fallback to treating entire payload as single zone
            return RuleEvaluator.evaluate_single_zone(rule_payload, seat_data)

        match_logic = str(rule_payload.get("match_logic", "ANY")).upper()
        satisfied_zones: List[Dict[str, Any]] = []
        all_matched_seats: List[str] = []
        summaries: List[str] = []

        for idx, zone in enumerate(zones):
            title = zone.get("title") or f"Selection #{idx + 1}"
            is_sat, matched, msg = RuleEvaluator.evaluate_single_zone(zone, seat_data)
            if is_sat:
                satisfied_zones.append({
                    "title": title,
                    "matched": matched,
                    "msg": msg
                })
                all_matched_seats.extend(matched)
                summaries.append(f"[{title}: {msg}]")
            else:
                summaries.append(f"[{title}: {msg}]")

        if match_logic == "ALL":
            is_satisfied = len(satisfied_zones) == len(zones)
            if is_satisfied:
                msg = f"All {len(zones)} seat selections satisfied! " + " | ".join(summaries)
            else:
                msg = f"Only {len(satisfied_zones)} of {len(zones)} selections satisfied: " + " | ".join(summaries)
            return is_satisfied, all_matched_seats, msg
        else:
            # Default "ANY" (OR logic)
            is_satisfied = len(satisfied_zones) > 0
            if is_satisfied:
                first = satisfied_zones[0]
                msg = f"Match found in {first['title']}! {first['msg']}"
                if len(satisfied_zones) > 1:
                    msg += f" (Total {len(satisfied_zones)} selections available)"
                return True, first["matched"], msg
            else:
                return False, [], f"None of the {len(zones)} selections currently match. Status: " + " | ".join(summaries)

    @staticmethod
    def evaluate_single_zone(
        zone: Dict[str, Any],
        seat_data: Dict[str, Any]
    ) -> Tuple[bool, List[str], str]:
        """
        Evaluates a single multi-row and seat number range zone.
        e.g.:
          - rows: B through I
          - seat_min: 12, seat_max: 25
          - quantity: 4
          - consecutive: True / False
        """
        rows_dict = seat_data.get("rows", {})
        layout_rows = seat_data.get("layout_rows", [])
        known_rows = list(rows_dict.keys()) if rows_dict else [lr.get("row_label") for lr in layout_rows if lr.get("row_label")]

        target_rows = expand_rows(
            row_spec=zone.get("rows") or zone.get("row"),
            start_row=zone.get("row_start") or zone.get("start_row"),
            end_row=zone.get("row_end") or zone.get("end_row"),
            known_rows=known_rows
        )

        seat_min = int(zone.get("seat_min", zone.get("start", zone.get("seat_start", 1))))
        seat_max = int(zone.get("seat_max", zone.get("end", zone.get("seat_end", 999))))
        quantity = int(zone.get("quantity", zone.get("count", zone.get("min_seats", 1))))
        consecutive = bool(zone.get("consecutive", False))

        row_label_str = f"Rows {target_rows[0]}-{target_rows[-1]}" if len(target_rows) > 1 else f"Row {target_rows[0]}"
        seat_range_str = f"Seats {seat_min}-{seat_max}" if seat_max < 900 else "all seats"

        # ----------------------------------------------------
        # Scenario A: Consecutive Adjacent Seats Required
        # ----------------------------------------------------
        if consecutive:
            for r in target_rows:
                # 1. Prefer layout_rows with aisle awareness
                matched_in_row: List[str] = []
                target_layout_row = next((lr for lr in layout_rows if lr.get("row_label") == r and not lr.get("is_walkway")), None)

                if target_layout_row and target_layout_row.get("grid_items"):
                    # Walk through physical sequence and detect contiguous available run without gaps
                    current_run: List[str] = []
                    for item in target_layout_row["grid_items"]:
                        if item.get("is_gap"):
                            # Aisle gap breaks consecutive run
                            current_run = []
                            continue

                        if not item.get("is_seat"):
                            current_run = []
                            continue

                        s_num = item.get("number", 0)
                        is_in_range = (seat_min <= s_num <= seat_max)
                        is_avail = item.get("is_available", False)

                        if is_in_range and is_avail:
                            current_run.append(item.get("seat_id", f"{r}{s_num}"))
                            if len(current_run) == quantity:
                                matched_in_row = list(current_run)
                                break
                        else:
                            current_run = []

                # 2. Fallback to rows_dict if layout_rows not present
                if not matched_in_row and r in rows_dict:
                    avail_in_row = sorted(
                        [s for s in rows_dict[r] if s.get("is_available") and seat_min <= s.get("number", 0) <= seat_max],
                        key=lambda x: x.get("number", 0)
                    )
                    nums = [s.get("number", 0) for s in avail_in_row]
                    for i in range(len(nums) - quantity + 1):
                        window = nums[i:i + quantity]
                        # Must be strictly adjacent numbers
                        if window == list(range(window[0], window[0] + quantity)):
                            matched_in_row = [f"{r}{n}" for n in window]
                            break

                if matched_in_row:
                    return (
                        True,
                        matched_in_row,
                        f"Found {quantity} consecutive seats in Row {r}: {', '.join(matched_in_row)} ({seat_range_str})"
                    )

            return (
                False,
                [],
                f"No sequence of {quantity} consecutive seats currently open in {row_label_str} ({seat_range_str})."
            )

        # ----------------------------------------------------
        # Scenario B: Any Available Seats in Range
        # ----------------------------------------------------
        # Check if single row has enough seats first
        all_zone_avail: List[str] = []
        for r in target_rows:
            if r in rows_dict:
                row_avail = [
                    s.get("seat_id", f"{r}{s.get('number')}")
                    for s in rows_dict[r]
                    if s.get("is_available") and seat_min <= s.get("number", 0) <= seat_max
                ]
                if len(row_avail) >= quantity:
                    return (
                        True,
                        row_avail[:quantity],
                        f"Found {len(row_avail)} seats in Row {r}: {', '.join(row_avail[:quantity])} ({seat_range_str})"
                    )
                all_zone_avail.extend(row_avail)

        if len(all_zone_avail) >= quantity:
            return (
                True,
                all_zone_avail[:quantity],
                f"Found {len(all_zone_avail)} seats across {row_label_str}: {', '.join(all_zone_avail[:quantity])} ({seat_range_str})"
            )

        return (
            False,
            [],
            f"Found only {len(all_zone_avail)}/{quantity} seats in {row_label_str} ({seat_range_str})."
        )
