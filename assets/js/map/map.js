import maplibregl from 'maplibre-gl';
import * as topojson from 'topojson-client';
import { loadJSON } from '../data.js';
import { state, onChange } from '../filters.js';

const CARTO_PAPER = {
  version: 8,
  glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
  sources: {
    'carto-paper': {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}@2x.png',
        'https://b.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}@2x.png',
        'https://c.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}@2x.png',
      ],
      tileSize: 256,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · © <a href="https://carto.com/attributions">CARTO</a>',
      maxzoom: 19,
    },
    'carto-labels': {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}@2x.png',
        'https://b.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}@2x.png',
        'https://c.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}@2x.png',
      ],
      tileSize: 256,
      maxzoom: 19,
    },
  },
  layers: [
    { id: 'basemap', type: 'raster', source: 'carto-paper' },
  ],
};

let mounted = false;
let map = null;
let manifest = {};
let selectedAreaId = null;
let chicagoBounds = null;
let areasFC = null;
let allByCa = [];
let selectedAreaFeatures = [];
let bucketByGps = new Map();

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function prettyDate(raw) {
  if (!raw || raw.length < 10) return '';
  const m = raw.slice(0, 2);
  const d = raw.slice(3, 5);
  const y = raw.slice(6, 10);
  const time = raw.slice(11).trim();
  return `${y}-${m}-${d} ${time}`;
}

function prettyType(t) {
  if (!t) return '';
  return t.charAt(0) + t.slice(1).toLowerCase();
}

function prettyName(n) {
  if (!n) return '';
  return n
    .toLowerCase()
    .split(/\s+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

const fmtNum = new Intl.NumberFormat('en-US').format;

function totalsFiltered(rows, filter) {
  const yearFilterActive = filter.years && filter.years.size < FULL_YEARS_COUNT;
  const totals = new Map();
  for (const r of rows) {
    if (filter.type !== 'ALL' && r.type !== filter.type) continue;
    if (filter.hour !== 'ALL' && r.hour !== filter.hour) continue;
    if (yearFilterActive && !filter.years.has(r.year)) continue;
    totals.set(r.ca, (totals.get(r.ca) || 0) + r.n);
  }
  return totals;
}

function parseHour(date) {
  if (!date || date.length < 19) return null;
  let h = parseInt(date.slice(11, 13), 10);
  if (Number.isNaN(h)) return null;
  const ampm = date.slice(20, 22);
  if (ampm === 'PM' && h !== 12) h += 12;
  if (ampm === 'AM' && h === 12) h = 0;
  return h;
}

const FULL_YEARS_COUNT = 26;

function filterFeatures(features, filter) {
  const yearFilterActive = filter.years && filter.years.size < FULL_YEARS_COUNT;
  if (filter.type === 'ALL' && filter.hour === 'ALL' && !yearFilterActive) return features;
  return features.filter(f => {
    const p = f.properties;
    if (filter.type !== 'ALL' && p.primary_type !== filter.type) return false;
    if (filter.hour !== 'ALL' && parseHour(p.date) !== filter.hour) return false;
    if (yearFilterActive) {
      const year = parseInt(p.date.slice(6, 10), 10);
      if (!filter.years.has(year)) return false;
    }
    return true;
  });
}

function aggregateByGps(features) {
  const buckets = new Map();
  for (const f of features) {
    const c = f.geometry.coordinates;
    const key = `${c[0].toFixed(6)},${c[1].toFixed(6)}`;
    let b = buckets.get(key);
    if (!b) {
      b = { key, coords: c, items: [] };
      buckets.set(key, b);
    }
    b.items.push(f);
  }
  return buckets;
}

// Roughly 50 m × 45 m at Chicago's latitude. Each non-empty cell becomes a
// fuzzy blob (circle-blur layer) — overlapping blobs blend smoothly so the
// visible result is a continuous gradient, not a quilt of polygons.
const CELL_DLNG = 0.0006;
const CELL_DLAT = 0.0004;

function buildDensityGrid(features) {
  if (!features.length) return { type: 'FeatureCollection', features: [] };

  const cells = new Map();
  for (const f of features) {
    const [lng, lat] = f.geometry.coordinates;
    const ix = Math.floor(lng / CELL_DLNG);
    const iy = Math.floor(lat / CELL_DLAT);
    const key = `${ix},${iy}`;
    cells.set(key, (cells.get(key) || 0) + 1);
  }

  const entries = [...cells.entries()].sort((a, b) => a[1] - b[1]);
  const N = entries.length;
  const cellFeatures = entries.map(([key, count], i) => {
    const [ix, iy] = key.split(',').map(Number);
    const cx = ix * CELL_DLNG + CELL_DLNG / 2;
    const cy = iy * CELL_DLAT + CELL_DLAT / 2;
    const t = N > 1 ? i / (N - 1) : 1;
    return {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [cx, cy] },
      properties: { count, t },
    };
  });

  return { type: 'FeatureCollection', features: cellFeatures };
}

function refreshSelectedAreaData(filter) {
  if (selectedAreaId === null || !map.getSource('crimes')) return;
  const filtered = filterFeatures(selectedAreaFeatures, filter);
  bucketByGps = aggregateByGps(filtered);

  const aggFeatures = [];
  for (const b of bucketByGps.values()) {
    aggFeatures.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: b.coords },
      properties: {
        key: b.key,
        count: b.items.length,
      },
    });
  }
  map.getSource('crimes').setData({ type: 'FeatureCollection', features: aggFeatures });
  map.getSource('density-grid').setData(buildDensityGrid(filtered));

  const metaEl = document.getElementById('area-meta');
  if (metaEl) {
    const yearsActive = filter.years && filter.years.size < FULL_YEARS_COUNT;
    const anyFilter = filter.type !== 'ALL' || filter.hour !== 'ALL' || yearsActive;
    if (!anyFilter) {
      metaEl.textContent = `${fmtNum(filtered.length)} incidents on file`;
    } else {
      metaEl.textContent = `${fmtNum(filtered.length)} of ${fmtNum(selectedAreaFeatures.length)} match the filter`;
    }
  }
}

function recomputeChoropleth(filter) {
  if (!map || !areasFC) return;
  const totals = totalsFiltered(allByCa, filter);
  let max = 0;
  for (const f of areasFC.features) {
    const t = totals.get(+f.properties.id) || 0;
    f.properties.total = t;
    if (t > max) max = t;
  }
  if (max === 0) max = 1;

  map.getSource('areas').setData(areasFC);

  map.setPaintProperty('areas-fill', 'fill-color', [
    'interpolate', ['linear'], ['get', 'total'],
    0,            '#f7f3ea',
    max * 0.20,   '#f0c9b6',
    max * 0.45,   '#e88c70',
    max * 0.70,   '#c14430',
    max,          '#7a1010',
  ]);
}

function boundsOfFeatures(features) {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  function visit(coords) {
    if (typeof coords[0] === 'number') {
      if (coords[0] < minLng) minLng = coords[0];
      if (coords[0] > maxLng) maxLng = coords[0];
      if (coords[1] < minLat) minLat = coords[1];
      if (coords[1] > maxLat) maxLat = coords[1];
    } else {
      for (const c of coords) visit(c);
    }
  }
  for (const f of features) visit(f.geometry.coordinates);
  return [[minLng, minLat], [maxLng, maxLat]];
}

async function loadAreaPoints(caId) {
  const files = manifest[String(caId)] || [];
  if (!files.length) return [];
  const fcs = await Promise.all(
    files.map(name => fetch(`data/points/${name}`).then(r => {
      if (!r.ok) throw new Error(`failed to load ${name}`);
      return r.json();
    }))
  );
  return fcs.flatMap(fc => fc.features || []);
}

function setAreaPanelLoading(props) {
  const panel = document.getElementById('area-panel');
  if (panel) panel.removeAttribute('hidden');
  const nameEl = document.getElementById('area-name');
  const metaEl = document.getElementById('area-meta');
  const volEl = document.getElementById('area-volume');
  if (nameEl) nameEl.textContent = prettyName(props.name);
  if (metaEl) metaEl.textContent = 'Loading incidents…';
  if (volEl) volEl.textContent = fmtNum(props.total || 0);
}

function setAreaPanelLoaded(featuresCount) {
  const metaEl = document.getElementById('area-meta');
  if (metaEl) metaEl.textContent = `${fmtNum(featuresCount)} incidents on file`;
}

function hideAreaPanel() {
  const panel = document.getElementById('area-panel');
  if (panel) panel.setAttribute('hidden', '');
}

function selectArea(feature) {
  if (selectedAreaId !== null) {
    map.setFeatureState({ source: 'areas', id: selectedAreaId }, { selected: false });
  }
  selectedAreaId = feature.id;
  map.setFeatureState({ source: 'areas', id: selectedAreaId }, { selected: true });

  const bounds = boundsOfFeatures([feature]);
  map.fitBounds(bounds, { padding: 60, duration: 800 });

  setAreaPanelLoading(feature.properties);

  loadAreaPoints(feature.properties.id).then(features => {
    selectedAreaFeatures = features;
    refreshSelectedAreaData(state);
  }).catch(err => {
    console.error('map: failed to load area', err);
    selectedAreaFeatures = [];
    setAreaPanelLoaded(0);
  });
}

function clearSelection() {
  if (selectedAreaId !== null) {
    map.setFeatureState({ source: 'areas', id: selectedAreaId }, { selected: false });
    selectedAreaId = null;
  }
  selectedAreaFeatures = [];
  if (chicagoBounds) {
    map.fitBounds(chicagoBounds, { padding: 24, duration: 700 });
  }
  if (map.getSource('crimes')) {
    map.getSource('crimes').setData({ type: 'FeatureCollection', features: [] });
  }
  if (map.getSource('density-grid')) {
    map.getSource('density-grid').setData({ type: 'FeatureCollection', features: [] });
  }
  hideAreaPanel();
}

function showSingleCrimePopup(coords, p) {
  new maplibregl.Popup({ closeButton: true, className: 'crimiviz-popup', maxWidth: '300px' })
    .setLngLat(coords)
    .setHTML(`
      <div class="popup-tag">${escapeHtml(prettyType(p.primary_type))}</div>
      <div class="popup-desc">${escapeHtml(p.description || '—')}</div>
      <div class="popup-row"><span>When</span><span>${escapeHtml(prettyDate(p.date))}</span></div>
      <div class="popup-row"><span>Where</span><span>${escapeHtml(p.location || '—')}</span></div>
      <div class="popup-row"><span>Arrest</span><span>${p.arrest === true || p.arrest === 'true' ? 'Yes' : 'No'}</span></div>
    `)
    .addTo(map);
}

function showStackPopup(coords, items) {
  const types = new Map();
  let arrests = 0;
  let earliest = items[0].properties.date;
  let latest = items[0].properties.date;
  for (const f of items) {
    const t = f.properties.primary_type || '—';
    types.set(t, (types.get(t) || 0) + 1);
    if (f.properties.arrest === true || f.properties.arrest === 'true') arrests++;
    if (f.properties.date < earliest) earliest = f.properties.date;
    if (f.properties.date > latest) latest = f.properties.date;
  }
  const top = [...types.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const location = items[0].properties.location || '—';

  const rows = top.map(([t, n]) =>
    `<div class="popup-row"><span>${escapeHtml(prettyType(t))}</span><span>${fmtNum(n)}</span></div>`
  ).join('');

  new maplibregl.Popup({ closeButton: true, className: 'crimiviz-popup', maxWidth: '320px' })
    .setLngLat(coords)
    .setHTML(`
      <div class="popup-tag">${fmtNum(items.length)} incidents · same block</div>
      <div class="popup-desc">${escapeHtml(location)}</div>
      ${rows}
      <div class="popup-meta">${fmtNum(arrests)} arrests · ${earliest.slice(6,10)} → ${latest.slice(6,10)}<br>Locations are anonymised to the nearest block by CPD.</div>
    `)
    .addTo(map);
}

export async function mountMap() {
  if (mounted) return;
  const root = document.getElementById('viz-map');
  if (!root) return;

  root.querySelector('.placeholder')?.remove();

  map = new maplibregl.Map({
    container: root,
    style: CARTO_PAPER,
    center: [-87.65, 41.88],
    zoom: 9.8,
    minZoom: 9,
    maxZoom: 22,
    attributionControl: false,
    cooperativeGestures: false,
  });

  map.addControl(new maplibregl.NavigationControl({ visualizePitch: false, showCompass: false }), 'top-right');
  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');

  await new Promise(resolve => map.on('load', resolve));

  const [topo, byCa, mfst] = await Promise.all([
    loadJSON('chicago_communities.topo'),
    loadJSON('by_community_area'),
    fetch('data/points/_manifest.json').then(r => r.json()),
  ]);
  manifest = mfst;
  allByCa = byCa;

  areasFC = topojson.feature(topo, topo.objects.data);
  for (const f of areasFC.features) {
    f.id = +f.properties.id;
    f.properties.total = 0;
  }
  chicagoBounds = boundsOfFeatures(areasFC.features);

  map.addSource('areas', { type: 'geojson', data: areasFC });

  // Choropleth fill — colored by filtered totals, fades out as the user zooms in past z11
  map.addLayer({
    id: 'areas-fill',
    type: 'fill',
    source: 'areas',
    paint: {
      'fill-color': '#f7f3ea',
      'fill-opacity': [
        'interpolate', ['linear'], ['zoom'],
        9,    0.78,
        11,   0.78,
        12,   0,
      ],
    },
  });

  // Permanent subtle outlines (still visible after the fill fades out)
  map.addLayer({
    id: 'areas-baseline',
    type: 'line',
    source: 'areas',
    paint: {
      'line-color': '#2a1f12',
      'line-width': 0.5,
      'line-opacity': [
        'interpolate', ['linear'], ['zoom'],
        9, 0.18, 11, 0.18, 12, 0.28,
      ],
    },
  });

  // Hover outline — appears on the area under the cursor
  map.addLayer({
    id: 'areas-hover',
    type: 'line',
    source: 'areas',
    paint: {
      'line-color': '#1a1a1a',
      'line-width': 1.5,
      'line-opacity': [
        'case',
        ['boolean', ['feature-state', 'hover'], false], 0.7,
        0,
      ],
    },
  });

  // Selected outline — accent red bold
  map.addLayer({
    id: 'areas-selected',
    type: 'line',
    source: 'areas',
    paint: {
      'line-color': '#7a1010',
      'line-width': 2.4,
      'line-opacity': [
        'case',
        ['boolean', ['feature-state', 'selected'], false], 1,
        0,
      ],
    },
  });

  map.addLayer({
    id: 'labels',
    type: 'raster',
    source: 'carto-labels',
    paint: { 'raster-opacity': 0.85 },
  });

  // Crimes source — features carry a 'count' property (number of crimes stacked at the same
  // block centroid by CPD's anonymisation).
  map.addSource('crimes', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });

  // Density layer — each cell is a fuzzy blurred blob; many overlapping blobs blend into
  // a smooth heatmap-style gradient. Color is the cell's percentile rank (`t`), so the
  // bottom 10% read as near-white and the top 10% as dark crimson regardless of the
  // absolute crime volume.
  map.addSource('density-grid', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });
  map.addLayer({
    id: 'density-grid',
    type: 'circle',
    source: 'density-grid',
    paint: {
      'circle-radius': [
        'interpolate', ['exponential', 1.8], ['zoom'],
        11, 8,
        13, 18,
        15, 36,
        17, 70,
      ],
      'circle-color': [
        'interpolate-hcl', ['linear'], ['get', 't'],
        0.00, '#ffffff',
        0.15, '#fde7dd',
        0.30, '#fbc7b3',
        0.45, '#ec8367',
        0.60, '#dd5d49',
        0.75, '#a52424',
        0.90, '#7e1414',
        1.00, '#5a0a0a',
      ],
      'circle-blur': 0.7,
      'circle-opacity': [
        'interpolate', ['linear'], ['zoom'],
        11, 0.55,
        15, 0.55,
        16, 0.4,
        17, 0,
      ],
      'circle-stroke-width': 0,
    },
  });

  // Individual GPS-unique points. Radius and color scale with the number of crimes stacked
  // at that exact block.
  map.addLayer({
    id: 'crimes-points',
    type: 'circle',
    source: 'crimes',
    minzoom: 14,
    paint: {
      'circle-radius': [
        'interpolate', ['linear'], ['zoom'],
        14, ['interpolate', ['linear'], ['get', 'count'], 1, 2,  10, 5,  100, 12, 1000, 24],
        17, ['interpolate', ['linear'], ['get', 'count'], 1, 5,  10, 12, 100, 28, 1000, 54],
        19, ['interpolate', ['linear'], ['get', 'count'], 1, 8,  10, 18, 100, 38, 1000, 70],
        22, ['interpolate', ['linear'], ['get', 'count'], 1, 14, 10, 30, 100, 60, 1000, 110],
      ],
      'circle-color': [
        'interpolate', ['linear'], ['get', 'count'],
        1,    '#c93023',
        25,   '#9a1210',
        200,  '#5a0a0a',
      ],
      'circle-stroke-color': '#f7f3ea',
      'circle-stroke-width': 0.6,
      'circle-opacity': [
        'interpolate', ['linear'], ['zoom'],
        14, 0,
        15, 0.55,
        16, 0.92,
      ],
    },
  });

  // Count label inside each circle, only when there's more than one crime stacked there
  // and the zoom is close enough that the circle has room for the number.
  map.addLayer({
    id: 'crimes-count-label',
    type: 'symbol',
    source: 'crimes',
    minzoom: 17,
    filter: ['>', ['get', 'count'], 1],
    layout: {
      'text-field': [
        'number-format', ['get', 'count'],
        { 'min-fraction-digits': 0, 'max-fraction-digits': 0 },
      ],
      'text-size': [
        'interpolate', ['linear'], ['zoom'],
        17, ['interpolate', ['linear'], ['get', 'count'], 1, 8,  100, 14, 1000, 22],
        19, ['interpolate', ['linear'], ['get', 'count'], 1, 11, 100, 20, 1000, 32],
        22, ['interpolate', ['linear'], ['get', 'count'], 1, 16, 100, 32, 1000, 52],
      ],
      'text-font': ['Open Sans Bold'],
      'text-allow-overlap': true,
      'text-ignore-placement': true,
    },
    paint: {
      'text-color': '#f7f3ea',
      'text-halo-color': 'rgba(0,0,0,0.45)',
      'text-halo-width': 0.8,
      'text-opacity': [
        'interpolate', ['linear'], ['zoom'],
        17, 0,
        17.5, 1,
      ],
    },
  });

  // ───────── Hover state ─────────
  let hoveredAreaId = null;
  map.on('mousemove', 'areas-fill', (e) => {
    if (!e.features.length) return;
    if (hoveredAreaId !== null) {
      map.setFeatureState({ source: 'areas', id: hoveredAreaId }, { hover: false });
    }
    hoveredAreaId = e.features[0].id;
    map.setFeatureState({ source: 'areas', id: hoveredAreaId }, { hover: true });
    map.getCanvas().style.cursor = 'pointer';
  });
  map.on('mouseleave', 'areas-fill', () => {
    if (hoveredAreaId !== null) {
      map.setFeatureState({ source: 'areas', id: hoveredAreaId }, { hover: false });
      hoveredAreaId = null;
    }
    map.getCanvas().style.cursor = '';
  });

  // ───────── Click handler (priority: points > clusters > areas > clear) ─────────
  map.on('click', (e) => {
    const points = map.queryRenderedFeatures(e.point, { layers: ['crimes-points'] });
    if (points.length > 0) {
      const p = points[0];
      const bucket = bucketByGps.get(p.properties.key);
      if (bucket && bucket.items.length === 1) {
        showSingleCrimePopup(p.geometry.coordinates, bucket.items[0].properties);
      } else if (bucket) {
        showStackPopup(p.geometry.coordinates, bucket.items);
      }
      return;
    }
    const areas = map.queryRenderedFeatures(e.point, { layers: ['areas-fill'] });
    if (areas.length > 0) {
      const areaFeature = areasFC.features.find(f => f.id === areas[0].id);
      if (areaFeature) selectArea(areaFeature);
      return;
    }
    if (selectedAreaId !== null) {
      clearSelection();
    }
  });

  map.on('mouseenter', 'crimes-points', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'crimes-points', () => { map.getCanvas().style.cursor = ''; });

  // ───────── Back to Chicago button ─────────
  const backBtn = document.getElementById('back-to-chicago');
  if (backBtn) backBtn.addEventListener('click', clearSelection);

  // Dynamic ratio scale shown in the map's top-right meta line.
  const scaleEl = document.getElementById('map-scale');
  const scaleFmt = new Intl.NumberFormat('en-US');
  function updateScaleLabel() {
    if (!scaleEl) return;
    const lat = map.getCenter().lat;
    const zoom = map.getZoom();
    const metersPerPixel = (156543.03392 * Math.cos(lat * Math.PI / 180)) / Math.pow(2, zoom);
    const ratio = Math.round((metersPerPixel * 96) / 0.0254);
    scaleEl.innerHTML = `N&nbsp;↑ · scale 1:${scaleFmt.format(ratio)}`;
  }
  map.on('zoom', updateScaleLabel);
  map.on('move', updateScaleLabel);
  updateScaleLabel();

  // Initial choropleth render + subscribe to filter changes
  recomputeChoropleth(state);
  onChange(s => {
    recomputeChoropleth(s);
    refreshSelectedAreaData(s);
  });

  // Initial fit
  map.fitBounds(chicagoBounds, { padding: 24, duration: 0 });

  // Resize when the panel becomes visible (lazy reveal)
  const panel = document.getElementById('panel-map');
  if (panel) {
    new MutationObserver(() => {
      if (!panel.hasAttribute('hidden')) {
        requestAnimationFrame(() => map.resize());
      }
    }).observe(panel, { attributes: true, attributeFilter: ['hidden'] });
  }

  mounted = true;
}
