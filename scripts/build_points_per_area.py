"""Split chicago_crimes.csv into one GeoJSON per community area.

Two-pass streaming pipeline. Output:
  data/points/{ca}.geojson           for areas under the per-file cap
  data/points/{ca}_pre.geojson       2001-2014 slice for oversized areas
  data/points/{ca}_post.geojson      2015-2026 slice for oversized areas
  data/points/_manifest.json         { ca → [file, ...] } the front-end uses

The cap is set so the largest single output file stays comfortably below
GitHub's 100 MB hard limit on individual files. In Chicago's data, only
Austin (CA 25) needs the split — every other area fits in one file with
its full history preserved.
"""

from __future__ import annotations

import csv
import json
import random
import sys
from collections import defaultdict
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent
CSV_PATH = REPO_ROOT / "chicago_crimes.csv"
OUT_DIR = REPO_ROOT / "data" / "points"
MANIFEST_PATH = OUT_DIR / "_manifest.json"

CAP_PER_FILE = 380_000  # ≈ 95 MB raw, safely under the 100 MB GitHub limit
SEED = 42
SPLIT_YEAR = 2015       # boundary used for areas that need two files

# Chicago bounding box — anything outside is a coordinate error
LAT_MIN, LAT_MAX = 41.60, 42.05
LON_MIN, LON_MAX = -87.95, -87.50


def parse_row(row: dict):
    ca_raw = row.get("Community Area") or ""
    lat = row.get("Latitude") or ""
    lon = row.get("Longitude") or ""
    date = row.get("Date") or ""
    if not (ca_raw and lat and lon and len(date) >= 10):
        return None
    try:
        ca = int(float(ca_raw))
        lat_f = float(lat)
        lon_f = float(lon)
        year = int(date[6:10])
    except ValueError:
        return None
    if ca < 1 or ca > 77:
        return None
    if not (LAT_MIN < lat_f < LAT_MAX and LON_MIN < lon_f < LON_MAX):
        return None
    return ca, year, lat_f, lon_f


def feature_dict(row: dict, lon: float, lat: float) -> dict:
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]},
        "properties": {
            "id": row.get("Case Number", ""),
            "date": row.get("Date", ""),
            "primary_type": row.get("Primary Type", ""),
            "description": row.get("Description", ""),
            "arrest": row.get("Arrest", "false") == "true",
            "location": row.get("Location Description", ""),
        },
    }


def main() -> int:
    if not CSV_PATH.exists():
        print(f"missing {CSV_PATH}", file=sys.stderr)
        return 1

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    # Drop any leftovers from a previous run so the directory only contains
    # the files this pass produces.
    for old in OUT_DIR.glob("*.geojson"):
        old.unlink()
    if MANIFEST_PATH.exists():
        MANIFEST_PATH.unlink()

    # ---------- Pass 1: count valid rows per area ----------
    print("pass 1: counting...", flush=True)
    counts: dict[int, int] = defaultdict(int)
    with CSV_PATH.open("r", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        for i, row in enumerate(reader):
            v = parse_row(row)
            if v is None:
                continue
            counts[v[0]] += 1
            if (i + 1) % 2_000_000 == 0:
                print(f"  pass1 {i+1:>10,} rows", flush=True)

    needs_split = {ca for ca, n in counts.items() if n > CAP_PER_FILE}
    p_keep = {}
    for ca, n in counts.items():
        if ca in needs_split:
            # Two output files for this area — effective cap doubles
            budget = 2 * CAP_PER_FILE
            p_keep[ca] = min(1.0, budget / n) if n else 1.0
        else:
            p_keep[ca] = 1.0

    print(f"  total valid rows:  {sum(counts.values()):,}")
    print(f"  areas needing split: {sorted(needs_split) or '—'}")

    # ---------- Pass 2: stream + write ----------
    print("pass 2: writing per-area files...", flush=True)
    random.seed(SEED)

    handles: dict[tuple, object] = {}
    first: dict[tuple, bool] = {}
    written: dict[tuple, int] = defaultdict(int)
    manifest: dict[str, list[str]] = {}

    for ca in range(1, 78):
        if ca in needs_split:
            for suffix in ("pre", "post"):
                key = (ca, suffix)
                path = OUT_DIR / f"{ca}_{suffix}.geojson"
                handles[key] = path.open("w", encoding="utf-8")
                handles[key].write('{"type":"FeatureCollection","features":[')
                first[key] = True
            manifest[str(ca)] = [f"{ca}_pre.geojson", f"{ca}_post.geojson"]
        else:
            key = (ca, "")
            path = OUT_DIR / f"{ca}.geojson"
            handles[key] = path.open("w", encoding="utf-8")
            handles[key].write('{"type":"FeatureCollection","features":[')
            first[key] = True
            manifest[str(ca)] = [f"{ca}.geojson"]

    with CSV_PATH.open("r", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        for i, row in enumerate(reader):
            v = parse_row(row)
            if v is None:
                continue
            ca, year, lat, lon = v
            if random.random() > p_keep[ca]:
                continue

            if ca in needs_split:
                suffix = "pre" if year < SPLIT_YEAR else "post"
            else:
                suffix = ""
            key = (ca, suffix)
            handle = handles[key]
            if first[key]:
                first[key] = False
            else:
                handle.write(",")
            handle.write(json.dumps(feature_dict(row, lon, lat), separators=(",", ":")))
            written[key] += 1

            if (i + 1) % 2_000_000 == 0:
                total = sum(written.values())
                print(f"  pass2 {i+1:>10,} rows · written {total:,}", flush=True)

    for key, handle in handles.items():
        handle.write("]}")
        handle.close()

    # ---------- Manifest + report ----------
    with MANIFEST_PATH.open("w", encoding="utf-8") as fh:
        json.dump(manifest, fh, separators=(",", ":"), indent=2, sort_keys=True)

    sizes = []
    for ca in range(1, 78):
        for name in manifest[str(ca)]:
            path = OUT_DIR / name
            sizes.append((path.name, path.stat().st_size))

    sizes.sort(key=lambda x: -x[1])
    print()
    print("Output files (top 5 by size):")
    for name, size in sizes[:5]:
        print(f"  {name:<28}  {size/(1024*1024):>6.1f} MB")
    print(f"\nTotal across {len(sizes)} files: {sum(s for _, s in sizes)/(1024*1024):.0f} MB raw")
    print(f"Total points kept: {sum(written.values()):,}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
