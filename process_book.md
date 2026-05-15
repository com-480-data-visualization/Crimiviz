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

### From Leaflet to D3, then to MapLibre, then to focus mode, then to a quantile density

Several iterations on the same panel. The skeleton shipped with Leaflet. We replaced that with a pure D3 + TopoJSON SVG choropleth on the 77 community areas — clean and lightweight, but a single level of detail. We rebuilt as a MapLibre semantic-zoom map showing 250k sampled points across the city, choropleth fading into a heatmap fading into individual points. It worked, but at street zoom the city-wide view felt overwhelming (a wall of red dots and overlapping clusters with no clear story) and the 250k Bernoulli sample dropped a lot of incidents that should have been there.

The current design is **focus mode**. At city zoom we show a filterable choropleth across the 77 community areas — coloured by total volume under the active filter, faint hover outline, no individual dots. Clicking any area fits the map to that area's bounds and loads its **complete** history (every reported incident on file for that neighbourhood) on demand. The choropleth fades out, and a density layer + individual block-level points take over. A "Back to Chicago" button (and a click on the basemap outside any area) returns to the city view.

This focus pattern earned us three wins.

**Every incident is on disk.** Each area sits in its own GeoJSON under `data/points/{ca}.geojson`, and the front-end fetches the file for the clicked area only. The total is 7.8M reported incidents preserved without sampling. The single area that would exceed GitHub's 100 MB per-file limit if we kept it whole — Austin (CA 25, 478k incidents) — is split by year into `25_pre.geojson` (2001-2014) and `25_post.geojson` (2015-present). A `_manifest.json` keeps the front-end ignorant of the split.

**The density layer is a real quantile heatmap.** A naive heatmap saturated to dark red everywhere because absolute density is high almost everywhere in Chicago. We replaced it with a custom 50 m × 45 m grid: count crimes per cell, sort the non-empty cells by count, give each one a percentile rank `t` in [0, 1], render the cell centres as `circle` features with `circle-blur ≈ 0.7` and `interpolate-hcl` colour stops. By construction the bottom 10% of cells reads as paper-white and the top 10% as dark crimson — independent of the area's absolute crime volume. The overlapping fuzzy circles blend into a continuous gradient that reads like a real heatmap rather than a quilt of polygons.

**Block-level honesty.** The CPD anonymises locations to the nearest block centroid for privacy. In CA 1 alone, 50k incidents share only 7,135 unique GPS coordinates (one of them stacks 950 crimes). Rather than show 950 perfectly overlapping dots, the front-end aggregates by GPS before rendering: every unique block becomes one circle, sized and coloured by the number of incidents stacked there. At zoom 17+, the count is printed inside the circle in Open Sans Bold. Clicking a circle opens a popup that either shows the single incident, or — if the block stacks several — lists the top categories, the arrest count, the date range, and explicitly notes that the location is a block centroid.

The sidebar carries the filters: a category dropdown (34 types), an hour slider (0-23), and 26 year pills (2001-2026, all on by default, with a single "All" reset). Category and hour drive the choropleth and the in-area subset; year filters the in-area subset only because the choropleth aggregate (`by_community_area.json`) has no year dimension. A small dynamic scale indicator in the top-right of the map updates with every pan and zoom (1:107k at city scale, 1:840 at street scale, 1:105 at maximum zoom).

### Pre-aggregated static JSON over live API

We considered fetching aggregates live from the Socrata API on each page load. We chose to **pre-aggregate at build time** instead: a single Python script issues a handful of `$group` queries to Socrata and writes ~10 small JSON files into `data/`. The site loads these statically. Trade-offs: the data is "fresh as of last build" rather than "fresh as of now", but loading is instant, deployment is trivial (no backend), and the API isn't rate-limited by the site's traffic. The script can be re-run before the deadline.

The MapLibre rebuild added a sister script: `build_points_per_area.py` reads the 1.9 GB CSV mirror, groups by community area, and writes one GeoJSON per area into `data/points/`. We considered shipping the full 8.5M as a single vector-tile pyramid (would require tippecanoe, a C tool we didn't want to introduce as a dependency) or a Bernoulli-sampled subset (clean but lossy). The per-area split solved both at once: every incident is preserved, the user only fetches the file for the area they clicked, and the front-end logic stays vanilla (a `fetch` per file plus a tiny manifest). One area exceeds GitHub's 100 MB per-file limit on its own and is split by year; the manifest hides that detail from the front-end.

### Filters: only what changes the map

We deliberately limited the controls to two: **primary crime type** and **hour of day**. Adding ward / district / arrest filters would multiply the combinatorics without adding much insight in the spatial view; those slices live in the Trends tab where they're charted instead of filtered.

### Editorial direction over generic dashboard

The first design pass leaned on a familiar dashboard idiom — dark surfaces, glassmorphism panels, a Chicago skyline hero. It looked competent and it looked like every other crime dashboard on the internet. We threw it out and rebuilt from a different starting point: *the city's own newspaper of incidents*. The masthead reads "The Chicago Crimiviz", the four panels are sections (Map / Trends / Insights), volumes are reported in newsroom typography. The site has a point of view rather than dashboard neutrality.

The design ships with a deliberate signature motif — drips that grow with the scroll position, blood splatters on the hero — that we kept rather than soften. The data is about violence; sterile graphic design would lie about it. The motif respects `prefers-reduced-motion` so accessibility isn't sacrificed for atmosphere.

### Palette in oklch, not hex

Every colour token uses `oklch()` rather than `hex` or `rgb`. Two reasons. First, perceptually uniform lightness — the four tones in our `--ink` scale (0.18 → 0.66) read as evenly spaced even though the colours sit on a warm-grey hue. Second, the single `--accent` is a deep newsprint red (oklch 0.58 / 0.205 / 28°) that holds AA contrast against the off-white paper without having to manually tune RGB. We declared all tokens once in `:root` of `main.css` and never touched a colour literal anywhere else.

*[To be expanded with screenshots of the editorial direction next to the original skeleton, plus the colour-scale discussion for the choropleth (sequential reds vs diverging) once Phase 3 lands.]*

## 5. Technical implementation

The site is a single static page (no bundler, no framework) backed by a small set of ES modules under `assets/js/`. The `data/` folder ships with pre-aggregated JSON files generated by `scripts/fetch_and_build.py` (Socrata SODA queries) and `scripts/build_topojson.py` (GeoJSON → TopoJSON conversion via the Python `topojson` library). D3 v7 and topojson-client are loaded from a CDN through a native `<script type="importmap">`.

### CSS architecture

Three files, by responsibility — not by feature:

- `assets/css/main.css` (~295 lines) — `:root` tokens, reset, typography utilities, top bar, sticky tab strip, footer, and every layout `@media` query. The "shell" of the page.
- `assets/css/components.css` (~982 lines) — every section's components: hero + KPI strip, nav cards, map panel + custom-styled filter controls, chart cards, insight cards, and the masthead.
- `assets/css/viz.css` (~463 lines) — the editorial animations (`mapZoom`, `cityFade`, `dotsReveal`, `printIn`, `bar-grow`, etc.) and the bleed system (drip filters, gradients, animation, scroll-driven JS hooks).

The split is large but not arbitrary: `main.css` rarely changes, `components.css` is where most of the work happens, and `viz.css` is what the design lives in. We can rebuild the design without touching `main.css`.

### Inline SVG defs that have to stay

The blood filters and gradients (`#bloodRough`, `#bloodGoo`, `#bloodSplat`, `#bloodWet`, `#bloodGrad`, `#dropGrad`, `#tipGrad`) are declared inside an inline `<svg class="blood-defs">` at the top of the body. They cannot live in a separate file because CSS references them via `filter: url(#bloodRough)` — those URLs are document-local. Moving the defs out would silently strip every editorial motif.

### State and module boundaries

State is held in a plain `state` object exported by `assets/js/filters.js` (`{ type, hour }`). The module also owns the input bindings (`bindControls()`) and the change dispatcher (`onChange(fn)`). Other modules import the state as read-only and subscribe to mutations through `onChange`.

`assets/js/data.js` is a 30-line `loadJSON(name)` helper backed by a `Map` cache plus an inflight de-dup. Every viz module sits on top of it.

`assets/js/main.js` boots the page: imports D3 + topojson-client, calls `bindControls()`, preloads `meta.json`, owns the tab routing, and wires the scroll-driven bleed animation. Phase 3+ modules will mount themselves into `#viz-map` / `#chart-*` / `#insight-*` and subscribe to `onChange`.

*[To be expanded with a small architecture diagram, the data-flow trace of a filter change, and the few performance pitfalls we hit (e.g., re-rendering 77 paths on every tooltip move).]*

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
