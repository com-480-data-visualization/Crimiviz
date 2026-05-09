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
python fetch_and_build.py     # crime aggregates (community area, hour, type, arrest, COVID)
python build_topojson.py      # community area boundaries (TopoJSON)
```

Re-run `fetch_and_build.py` whenever you want fresh data — Chicago publishes daily updates.

## Why server-side aggregation

The raw dataset has ~8.5M rows. We never download it. Each aggregate is a single Socrata SODA query that uses `$select` / `$where` / `$group` so the city's servers do the heavy lifting and we receive a few hundred rows.

Endpoint: `https://data.cityofchicago.org/resource/ijzp-q8t2.json`
Resource id: `ijzp-q8t2`
