import * as d3 from 'd3';
import * as topojson from 'topojson-client';
import { loadJSON } from '../data.js';

const W = 800;
const H = 600;

let mounted = false;
let svg = null;
let paths = null;
let aggregates = [];
let interpolator = null;

const fmt = d3.format('.2s');

function resolveCssColor(cssVar) {
  const probe = document.createElement('div');
  probe.style.color = `var(${cssVar})`;
  probe.style.position = 'absolute';
  probe.style.visibility = 'hidden';
  document.body.appendChild(probe);
  const c = getComputedStyle(probe).color;
  probe.remove();
  return c;
}

function totalsFor(filter) {
  const totals = new Map();
  for (const r of aggregates) {
    if (filter.type !== 'ALL' && r.type !== filter.type) continue;
    if (filter.hour !== 'ALL' && r.hour !== filter.hour) continue;
    totals.set(r.ca, (totals.get(r.ca) || 0) + r.n);
  }
  return totals;
}

function buildScale(totals) {
  const max = d3.max(totals.values()) || 1;
  return d3.scaleSequentialPow(interpolator)
    .exponent(0.5)
    .domain([0, max]);
}

function paintLegend(scale) {
  const max = scale.domain()[1];
  const stops = [0, 0.25, 0.5, 0.75, 1].map(t => scale(t * max));
  const bar = document.querySelector('#map-legend .legend-bar');
  if (bar) bar.style.background = `linear-gradient(90deg, ${stops.join(', ')})`;

  const labels = document.querySelectorAll('#map-legend .legend-scale span');
  if (labels.length === 3) {
    labels[0].textContent = '0';
    labels[1].textContent = fmt(max / 2);
    labels[2].textContent = fmt(max);
  }
}

export function updateMap(filter = { type: 'ALL', hour: 'ALL' }) {
  if (!mounted || !paths) return;
  const totals = totalsFor(filter);
  const scale = buildScale(totals);

  paths.transition().duration(280)
    .attr('fill', d => scale(totals.get(+d.properties.id) || 0));

  paintLegend(scale);
}

export async function mountMap() {
  if (mounted) return;
  const root = document.getElementById('viz-map');
  if (!root) return;

  let topo, agg;
  try {
    [topo, agg] = await Promise.all([
      loadJSON('chicago_communities.topo'),
      loadJSON('by_community_area'),
    ]);
  } catch (err) {
    console.error('map: failed to load data', err);
    return;
  }

  aggregates = agg;
  interpolator = d3.interpolateLab(resolveCssColor('--paper'), resolveCssColor('--accent'));

  const fc = topojson.feature(topo, topo.objects.data);
  const features = fc.features;

  const placeholder = root.querySelector('.placeholder');
  if (placeholder) placeholder.remove();

  svg = d3.select(root).append('svg')
    .attr('class', 'choropleth')
    .attr('viewBox', `0 0 ${W} ${H}`)
    .attr('preserveAspectRatio', 'xMidYMid meet');

  const projection = d3.geoMercator().fitSize([W, H], fc);
  const pathGen = d3.geoPath(projection);

  paths = svg.append('g').attr('class', 'areas')
    .selectAll('path')
    .data(features, d => d.properties.id)
    .join('path')
    .attr('class', 'area')
    .attr('d', pathGen)
    .attr('data-id', d => d.properties.id)
    .attr('data-name', d => d.properties.name);

  mounted = true;
  updateMap();
}
