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
    """data/by_community_area.json — area × primary_type × hour counts.

    A single SODA query gives us at most 78 * 34 * 24 = 63 648 rows.
    We page through it because Socrata caps a single response at 50k rows.
    """
    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        page = fetch({
            "$select": (
                "community_area, primary_type, "
                "date_extract_hh(date) AS hour, count(*) AS n"
            ),
            "$where": (
                "community_area IS NOT NULL AND community_area != '0' "
                "AND primary_type IS NOT NULL"
            ),
            "$group": "community_area, primary_type, hour",
            "$order": "community_area, primary_type, hour",
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
            "hour": int(r["hour"]),
            "n": int(r["n"]),
        }
        for r in rows
    ]
    write_json("by_community_area.json", cleaned)


def build_temporal_aggregates() -> None:
    """seasonality, time_of_day, crime_types, arrest_rates, covid_comparison."""
    raise NotImplementedError


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
