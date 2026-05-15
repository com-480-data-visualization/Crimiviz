import * as d3 from 'd3';
import * as topojson from 'topojson-client';
import { loadJSON } from './data.js';
import { state, setType, setHour, onChange } from './filters.js';
import { mountMap, updateMap } from './map/choropleth.js';

window.__crimiviz = { d3, topojson, state };

const typeEl = document.getElementById('filter-type');
const hourEl = document.getElementById('filter-hour');
const resetBtn = document.getElementById('filter-reset');

if (typeEl) {
  typeEl.addEventListener('change', () => setType(typeEl.value));
}
if (hourEl) {
  hourEl.addEventListener('input', () => setHour(hourEl.value));
}
if (resetBtn) {
  resetBtn.addEventListener('click', () => {
    setType('ALL');
    setHour('ALL');
  });
}

onChange(s => updateMap(s));

mountMap();

loadJSON('meta').then(meta => {
  console.info(`crimiviz · ${meta.total_rows.toLocaleString()} rows · ${meta.min_date.slice(0,10)} → ${meta.max_date.slice(0,10)}`);
});
