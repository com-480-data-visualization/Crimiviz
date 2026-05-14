import * as d3 from 'd3';
import * as topojson from 'topojson-client';
import { loadJSON } from '../data.js';

const W = 800;
const H = 600;

let mounted = false;
let svg = null;
let pathGen = null;
let features = [];

export async function mountMap() {
  if (mounted) return;
  const root = document.getElementById('viz-map');
  if (!root) return;

  let topo;
  try {
    topo = await loadJSON('chicago_communities.topo');
  } catch (err) {
    console.error('map: failed to load boundaries', err);
    return;
  }

  const fc = topojson.feature(topo, topo.objects.data);
  features = fc.features;

  const placeholder = root.querySelector('.placeholder');
  if (placeholder) placeholder.remove();

  svg = d3.select(root).append('svg')
    .attr('class', 'choropleth')
    .attr('viewBox', `0 0 ${W} ${H}`)
    .attr('preserveAspectRatio', 'xMidYMid meet');

  const projection = d3.geoMercator().fitSize([W, H], fc);
  pathGen = d3.geoPath(projection);

  svg.append('g')
    .attr('class', 'areas')
    .selectAll('path')
    .data(features, d => d.properties.id)
    .join('path')
    .attr('class', 'area')
    .attr('d', pathGen)
    .attr('data-id', d => d.properties.id)
    .attr('data-name', d => d.properties.name);

  mounted = true;
}
