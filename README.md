# Crimiviz

Interactive visualization of Chicago crime patterns from 2001 to today, built for the EPFL Data Visualization course by Julien Erbland, Mathis Richard and Max Henrotin.

Live: **https://chicagocrime.vercel.app/**

## What it does

Crimiviz lets you explore ~8.5 million crime incidents reported by the Chicago Police Department through three lenses:

- **Map** — choropleth of the 78 Chicago Community Areas, filterable by primary crime type and hour of day.
- **Trends** — seasonality, time-of-day rhythms, distribution by primary type, and arrest-rate disparities.
- **Insights** — three storytelling deep-dives: pre/post COVID shift, election-period impact, and major Chicago events overlaid on crime volume.

Target audience: urban planners, public-safety researchers, city officials.

## Repository layout

```
.
├── index.html              entry point (single-page, 4 tabs)
├── assets/
│   ├── css/                main, components, viz styles
│   └── js/                 ES modules (map, charts, insights)
├── data/                   pre-aggregated JSON (committed, ~hundreds of KB)
├── scripts/                Python pipeline that builds data/
├── data_exploration.ipynb  exploratory notebook (M1)
├── milestone1.pdf          requirements & feasibility
├── milestone2.pdf          design & roadmap
├── milestone3.pdf          final delivery brief
├── process_book.md         narrative behind the project
└── process_book.pdf        process book exported (final deliverable)
```

The raw `chicago_crimes.csv` (1.9 GB) is gitignored. Either download it from the Kaggle mirror or rely on the live Chicago Data Portal API used by the build scripts.

## Technical setup

### Prerequisites

- Python 3.10+ (only required to rebuild the data files)
- Any modern browser
- Optionally: Node.js + `mapshaper` to regenerate the TopoJSON from a fresh GeoJSON

### Run the site locally

```bash
git clone <repo-url>
cd Crimiviz
python3 -m http.server 8000
# open http://localhost:8000
```

The site reads `data/*.json` directly. No build step.

### Rebuild the data

The `data/` JSON files are checked in. To refresh them from the live Chicago Data Portal:

```bash
cd scripts
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python fetch_and_build.py
python build_topojson.py
```

This pulls aggregates server-side (Socrata SODA queries with `$group`) — it does not download the 8.5 M raw rows.

### Deployment

The repository is linked to a Vercel project that auto-deploys `main`. There is no build command — Vercel serves the static files as-is.

## Stack

- Vanilla HTML / CSS / JavaScript (ES modules, no bundler)
- D3.js v7 + topojson-client (CDN)
- Python 3 (`requests`, `tqdm`) for the data pipeline
- Hosted on Vercel

## Data

- Source: [Chicago Data Portal — Crimes 2001 to Present](https://data.cityofchicago.org/Public-Safety/Crimes-2001-to-Present/ijzp-q8t2/about_data) (Socrata SODA API, resource id `ijzp-q8t2`)
- Boundaries: [Chicago Community Areas](https://data.cityofchicago.org/Facilities-Geographic-Boundaries/Boundaries-Community-Areas-current-/cauq-8yn6) converted to TopoJSON
- Mirror used during EDA: [Kaggle](https://www.kaggle.com/datasets/aliafzal9323/chicago-crime-dataset-2024-2026)

## Milestones

- **Milestone 1** (10%) — `milestone1.pdf` — requirements and dataset feasibility.
- **Milestone 2** (10%) — `milestone2.pdf` — sketches, tooling and MVP scope.
- **Milestone 3** (80%) — `milestone3.pdf` — final delivery (this README, the live site, the process book PDF and the screencast).
