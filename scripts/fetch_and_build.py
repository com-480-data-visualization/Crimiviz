"""Build the static JSON aggregates that the Crimiviz front-end consumes.

Pulls server-side aggregates from the Chicago Data Portal so we never
have to download the full 8.5M-row dataset.
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path
from typing import Any

import requests
from tqdm import tqdm


SOCRATA_BASE = "https://data.cityofchicago.org/resource/ijzp-q8t2.json"

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "data"

REQUEST_TIMEOUT = 60
PAGE_SIZE = 50000


def fetch(params: dict[str, Any]) -> list[dict[str, Any]]:
    """Issue a single SODA query, return parsed JSON rows."""
    response = requests.get(SOCRATA_BASE, params=params, timeout=REQUEST_TIMEOUT)
    response.raise_for_status()
    return response.json()


def write_json(name: str, payload: Any) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    path = DATA_DIR / name
    with path.open("w", encoding="utf-8") as fh:
        json.dump(payload, fh, separators=(",", ":"))
    size_kb = path.stat().st_size / 1024
    print(f"  wrote {path.relative_to(REPO_ROOT)} ({size_kb:.1f} KB)")


def build_community_area_aggregates() -> None:
    """data/by_community_area.json — area × primary_type × year × hour counts.

    Worst-case row count is 77 * 34 * 26 * 24 ≈ 1.6M; sparsity drops this
    into the few-hundred-thousand range. Paginated through Socrata's 50k
    response cap.
    """
    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        page = fetch({
            "$select": (
                "community_area, primary_type, "
                "date_extract_y(date) AS year, "
                "date_extract_hh(date) AS hour, count(*) AS n"
            ),
            "$where": (
                "community_area IS NOT NULL AND community_area != '0' "
                "AND primary_type IS NOT NULL"
            ),
            "$group": "community_area, primary_type, year, hour",
            "$order": "community_area, primary_type, year, hour",
            "$limit": PAGE_SIZE,
            "$offset": offset,
        })
        if not page:
            break
        rows.extend(page)
        if len(page) < PAGE_SIZE:
            break
        offset += PAGE_SIZE
        time.sleep(0.2)

    cleaned = [
        {
            "ca": int(float(r["community_area"])),
            "type": r["primary_type"],
            "year": int(r["year"]),
            "hour": int(r["hour"]),
            "n": int(r["n"]),
        }
        for r in rows
    ]
    write_json("by_community_area.json", cleaned)


def build_temporal_aggregates() -> None:
    """seasonality, time_of_day, crime_types, arrest_rates, covid_comparison."""
    seasonality = fetch({
        "$select": (
            "date_extract_y(date) AS year, "
            "date_extract_m(date) AS month, "
            "count(*) AS n"
        ),
        "$group": "year, month",
        "$order": "year, month",
        "$limit": 500,
    })
    write_json(
        "seasonality.json",
        [
            {"year": int(r["year"]), "month": int(r["month"]), "n": int(r["n"])}
            for r in seasonality
        ],
    )

    time_of_day = fetch({
        "$select": (
            "primary_type, date_extract_hh(date) AS hour, count(*) AS n"
        ),
        "$where": "primary_type IS NOT NULL",
        "$group": "primary_type, hour",
        "$order": "primary_type, hour",
        "$limit": 2000,
    })
    write_json(
        "time_of_day.json",
        [
            {"type": r["primary_type"], "hour": int(r["hour"]), "n": int(r["n"])}
            for r in time_of_day
        ],
    )

    crime_types = fetch({
        "$select": "primary_type, count(*) AS n",
        "$where": "primary_type IS NOT NULL",
        "$group": "primary_type",
        "$order": "n DESC",
        "$limit": 100,
    })
    write_json(
        "crime_types.json",
        [{"type": r["primary_type"], "n": int(r["n"])} for r in crime_types],
    )

    totals_by_type = {r["type"]: r["n"] for r in [
        {"type": r["primary_type"], "n": int(r["n"])} for r in crime_types
    ]}
    arrests = fetch({
        "$select": "primary_type, count(*) AS n",
        "$where": "arrest = true AND primary_type IS NOT NULL",
        "$group": "primary_type",
        "$order": "n DESC",
        "$limit": 100,
    })
    arrest_payload = []
    for r in arrests:
        ptype = r["primary_type"]
        total = totals_by_type.get(ptype, 0)
        arrests_n = int(r["n"])
        rate = arrests_n / total if total else 0.0
        arrest_payload.append({
            "type": ptype,
            "total": total,
            "arrests": arrests_n,
            "rate": round(rate, 4),
        })
    arrest_payload.sort(key=lambda r: r["rate"], reverse=True)
    write_json("arrest_rates.json", arrest_payload)

    def fetch_year_locations(year: int) -> dict[str, int]:
        rows = fetch({
            "$select": "location_description, count(*) AS n",
            "$where": (
                f"date_extract_y(date) = {year} "
                "AND location_description IS NOT NULL"
            ),
            "$group": "location_description",
            "$order": "n DESC",
            "$limit": 500,
        })
        return {r["location_description"]: int(r["n"]) for r in rows}

    pre = fetch_year_locations(2019)
    post = fetch_year_locations(2023)
    locations = sorted(set(pre) | set(post), key=lambda k: -(pre.get(k, 0) + post.get(k, 0)))
    covid = []
    for loc in locations[:25]:
        a = pre.get(loc, 0)
        b = post.get(loc, 0)
        delta = (b - a) / a if a else None
        covid.append({
            "location": loc,
            "y2019": a,
            "y2023": b,
            "delta": round(delta, 4) if delta is not None else None,
        })
    write_json("covid_comparison.json", covid)


def build_meta() -> None:
    """data/meta.json — totals, date range, generated_at."""
    from datetime import datetime, timezone

    total = fetch({"$select": "count(*) AS n"})[0]["n"]
    bounds = fetch({"$select": "min(date) AS min_date, max(date) AS max_date"})[0]
    write_json(
        "meta.json",
        {
            "total_rows": int(total),
            "min_date": bounds["min_date"],
            "max_date": bounds["max_date"],
            "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "source": SOCRATA_BASE,
        },
    )


def main() -> int:
    steps = [
        ("community area aggregates", build_community_area_aggregates),
        ("temporal aggregates", build_temporal_aggregates),
        ("meta", build_meta),
    ]
    for label, fn in tqdm(steps, desc="build", unit="step"):
        try:
            fn()
        except NotImplementedError:
            tqdm.write(f"  [skip] {label} not yet implemented")
            continue
    return 0


if __name__ == "__main__":
    sys.exit(main())
