"""Fetch the 78 Chicago Community Area boundaries and write a compact TopoJSON.

The boundaries come from the Chicago Open Data Portal as GeoJSON; we
convert to TopoJSON to shrink the payload by roughly an order of
magnitude.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import requests
import topojson


SOURCE_URL = "https://data.cityofchicago.org/resource/igwz-8jzy.geojson"
SOURCE_LIMIT = 200

REPO_ROOT = Path(__file__).resolve().parent.parent
OUT_PATH = REPO_ROOT / "data" / "chicago_communities.topo.json"


def slim_properties(feature: dict) -> dict:
    """Keep only the properties the front-end actually uses."""
    props = feature.get("properties", {}) or {}
    keep = {}
    for src, dst in (
        ("area_numbe", "id"),
        ("area_num_1", "id_alt"),
        ("community", "name"),
    ):
        if src in props and props[src] is not None:
            keep[dst] = props[src]
    feature["properties"] = keep
    return feature


def main() -> int:
    print(f"fetching {SOURCE_URL}")
    response = requests.get(
        SOURCE_URL, timeout=120, params={"$limit": SOURCE_LIMIT}
    )
    response.raise_for_status()
    geojson = response.json()

    feature_count = len(geojson.get("features", []))
    print(f"  got {feature_count} features")

    geojson["features"] = [slim_properties(f) for f in geojson["features"]]

    topo = topojson.Topology(
        data=geojson,
        prequantize=1e5,
        toposimplify=0.0001,
    )

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUT_PATH.open("w", encoding="utf-8") as fh:
        fh.write(topo.to_json())

    size_kb = OUT_PATH.stat().st_size / 1024
    print(f"  wrote {OUT_PATH.relative_to(REPO_ROOT)} ({size_kb:.1f} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
