# Crimiviz — Process Book

*Julien Erbland · Mathis Richard · Max Henrotin*
*EPFL — Data Visualization course, spring 2026*

---

## 1. From idea to scope

Our starting point was a simple intuition: most public-facing crime maps in Chicago are visually cluttered, treat all hours of the day equally, and target an analyst audience rather than a general one. The Chicago Police Department dashboard is comprehensive but technical; existing aggregators stop at static heatmaps. We wanted to push further on two axes the existing work tends to flatten — *when* and *where* — and to do so with a polish that makes patterns immediately readable.

The dataset (Chicago Police Department, mirrored on Kaggle and reachable through the city's Socrata API) is large but well-shaped: 8.5M rows from 2001 to today, with primary type, location description, geographic coordinates and arrest outcome on every record. That gave us enough material for both spatial and temporal stories without supplementary sources. We also liked that the file is updated daily, leaving the door open for a "live" feel later.

*[To be expanded with the early team conversations, the alternatives we briefly considered (NYC complaints, San Francisco police calls), and why Chicago's granularity won.]*

## 2. Data and feasibility

The first feasibility shock was volume: 8.5M points are far too many to render on the client. We dismissed naive marker maps early. Two strategies remained: aggregating to administrative polygons (community areas, wards, beats) or hex-binning. We chose **community areas (78)** as the spatial unit — fine enough to show neighborhood contrast, coarse enough to colour cleanly.

Missing coordinates affected 1.11% of the data; we excluded those rows from spatial analyses but kept them in temporal aggregates where the location was non-essential. Dates needed parsing from `MM/DD/YYYY HH:MM:SS AM/PM` to ISO timestamps. Crime type cardinality was a more interesting decision: 34 primary categories is workable, 569 detailed descriptions is not. We standardized on primary type for filters and surfaces, with detailed descriptions reserved for tooltip context.

*[To be expanded with the actual EDA findings — graphs, top-5 location types, arrest-rate baseline of 25.1%, the COVID dip and recovery.]*

## 3. Sketches from Milestone 1, expanded

The original sketches in Milestone 1 envisioned a hexbin map and an associated radial "threat clock". Through Milestone 2 the threat clock moved to the optional list (it didn't carry enough independent information to justify a panel of its own), and the hexbin gave way to a community-area choropleth — the boundaries are a stronger anchor for a viewer who isn't already familiar with Chicago.

We also reorganized the layout from a single-page grid to a four-tab navigation (Home, Map, Trends, Insights). This costs us some at-a-glance comparison but buys us focus inside each tab; the data story moves from "everything at once" to "follow the path". The skeleton committed in mid-April reflects this revised structure.

*[To be expanded with redrawn sketches, before/after of the layout decisions, and the rationale captured during our team review meetings.]*

## 4. Design decisions

### Choropleth over hexbin

A hexbin would have been "the cool answer", but it suffers when overlaid on a city whose neighborhoods are widely recognized by residents. Community-area boundaries give the map a familiar grammar — a viewer recognizes "Loop", "Lincoln Park", "Englewood" — and lets us anchor narrative.

### D3 over Leaflet

Our skeleton initially leaned on Leaflet for the map. We pivoted to a pure D3 + TopoJSON rendering because (a) Milestone 2 promised this stack, (b) a tile-backed map was distracting context for the choropleth, (c) D3 lets us animate transitions cleanly when filters change.

### Pre-aggregated static JSON over live API

We considered fetching aggregates live from the Socrata API on each page load. We chose to **pre-aggregate at build time** instead: a single Python script issues a handful of `$group` queries to Socrata and writes ~10 small JSON files into `data/`. The site loads these statically. Trade-offs: the data is "fresh as of last build" rather than "fresh as of now", but loading is instant, deployment is trivial (no backend), and the API isn't rate-limited by the site's traffic. The script can be re-run before the deadline.

### Filters: only what changes the map

We deliberately limited the controls to two: **primary crime type** and **hour of day**. Adding ward / district / arrest filters would multiply the combinatorics without adding much insight in the spatial view; those slices live in the Trends tab where they're charted instead of filtered.

*[To be expanded with screenshots showing the design before/after each decision, plus the colour-palette discussion (sequential OrRd vs viridis), and the dark-vs-light theme call.]*

## 5. Technical implementation

The site is a single static page (no bundler, no framework) backed by a small set of ES modules under `assets/js/`. The `data/` folder ships with pre-aggregated JSON files generated by `scripts/fetch_and_build.py` (Socrata SODA queries) and `scripts/build_topojson.py` (GeoJSON → TopoJSON conversion via mapshaper / topojson-server). D3 v7 and topojson-client are loaded from a CDN.

State is held in a plain `state` object exported by `assets/js/main.js`. Each visualization module subscribes to filter changes and re-renders. Cross-filtering (clicking a community area on the map filters the temporal charts) is opt-in behind a single dispatcher function.

*[To be expanded with a small architecture diagram, the data-flow trace of a filter change, and the few performance pitfalls we hit (e.g., re-rendering 78 paths on every tooltip move).]*

## 6. Challenges

*[To be filled as we go. Candidate entries: parsing edge cases in Socrata responses, tuning the colour scale to not crush the long tail of low-crime areas, getting D3 transitions to play nicely with absolute positioning of tooltips, mobile responsiveness with SVG.]*

## 7. Final result

*[Screenshots of the final site, one per tab, with captions summarizing the story each tab tells. Also a link to the live site and the screencast.]*

## 8. Peer assessment

| Member | Main contributions | Estimated share |
|---|---|---|
| Julien Erbland | UI / layout integration from Claude Design output, choropleth rendering and tooltip, mobile and accessibility passes | *to be filled* |
| Mathis Richard | Data pipeline (Socrata aggregations), temporal charts (time-of-day, COVID comparison), data documentation | *to be filled* |
| Max Henrotin | Project orchestration, choropleth coloring, filters and cross-filtering, seasonality and arrest-rate charts, README and process book | *to be filled* |

We worked mostly in pair or trio sessions — `Co-authored-by` trailers in the git history reflect this. The shares above are the team's own assessment of relative effort across the milestones.

*[To be finalized after the final review session. Add anecdotes that illustrate each member's contribution if space allows.]*
