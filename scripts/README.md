# scripts/

Build pipeline for Crimiviz. Pulls aggregates from the Chicago Data Portal and writes static JSON files into `../data/` that the front-end loads at runtime.

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Run

```bash
python fetch_and_build.py          # crime aggregates (community area, hour, type, arrest, COVID)
python build_topojson.py           # community area boundaries (TopoJSON)
python build_points_per_area.py    # ~7.8M individual crimes split into one GeoJSON per community area
```

Re-run `fetch_and_build.py` whenever you want fresh aggregate data — Chicago publishes daily updates.

`build_points_per_area.py` reads the local `chicago_crimes.csv` (1.9 GB, gitignored) and writes 78 files into `data/points/` (one per community area, plus a year-split for the largest area) along with a `_manifest.json` mapping `ca_id → [filename, …]`. Re-run after refreshing the CSV from the Kaggle mirror. Total disk footprint is ~1.85 GB raw / ~440 MB gzipped served.

## Why server-side aggregation

The full dataset has ~8.5M rows. The aggregate pipeline (`fetch_and_build.py`) never downloads it: each output is a single Socrata SODA query using `$select` / `$where` / `$group` so the city's servers do the heavy lifting and we receive a few hundred rows.

Endpoint: `https://data.cityofchicago.org/resource/ijzp-q8t2.json`
Resource id: `ijzp-q8t2`

## Why one file per community area

The map's individual-points layer can't ship 8.5M points to the browser — even gzipped that's hundreds of MB and would tank parse time. We sidestep that by splitting the data the same way the user thinks about the city: one file per community area. The browser only loads the file for the area the user clicks on (a few MB gzipped), never the city as a whole.

`build_points_per_area.py` does the split in two streaming passes (no large in-memory buffers). Areas under the per-file size cap (set so the largest output stays comfortably below GitHub's 100 MB limit) keep their full history. Any area that would exceed the cap — in practice only Austin (CA 25, 478k incidents) — is split into a `_pre.geojson` (2001-2014) and a `_post.geojson` (2015-present) pair so each file fits.

The browser reads `data/points/_manifest.json` to know how many files to fetch for any given area.
