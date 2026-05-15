import { loadJSON } from '../data.js';

const fmtNum = new Intl.NumberFormat('en-US').format;
const fmtPct = (v) => (v * 100).toFixed(1) + '%';

let arrestRates = new Map();
let ready = false;

const tip = document.getElementById('map-tooltip');
const mapStage = document.querySelector('.map-stage');

function positionAt(e) {
  if (!mapStage || !tip) return;
  const r = mapStage.getBoundingClientRect();
  const x = e.clientX - r.left + 16;
  const y = e.clientY - r.top + 16;
  tip.style.left = Math.min(x, r.width - 220) + 'px';
  tip.style.top = Math.min(y, r.height - 130) + 'px';
}

function show() {
  if (!tip) return;
  tip.style.display = 'block';
  tip.setAttribute('aria-hidden', 'false');
}

function hide() {
  if (!tip) return;
  tip.style.display = 'none';
  tip.setAttribute('aria-hidden', 'true');
}

function fill({ name, total, topCategory, arrestRate }) {
  if (!tip) return;
  const area = tip.querySelector('.tt-area');
  const rows = tip.querySelectorAll('.tt-row .v');
  if (area) area.textContent = name;
  if (rows[0]) rows[0].textContent = total > 0 ? fmtNum(total) : '—';
  if (rows[1]) rows[1].textContent = topCategory;
  if (rows[2]) rows[2].textContent = total > 0 ? fmtPct(arrestRate) : '—';
}

function summarise(caId, filter, aggregates) {
  let total = 0;
  let weightedArrests = 0;
  const byType = new Map();
  for (const r of aggregates) {
    if (r.ca !== caId) continue;
    if (filter.type !== 'ALL' && r.type !== filter.type) continue;
    if (filter.hour !== 'ALL' && r.hour !== filter.hour) continue;
    total += r.n;
    byType.set(r.type, (byType.get(r.type) || 0) + r.n);
    weightedArrests += r.n * (arrestRates.get(r.type) || 0);
  }
  const top = [...byType.entries()].sort((a, b) => b[1] - a[1])[0];
  return {
    total,
    topCategory: top ? prettyType(top[0]) : '—',
    arrestRate: total > 0 ? weightedArrests / total : 0,
  };
}

function prettyType(t) {
  return t.charAt(0) + t.slice(1).toLowerCase();
}

export async function initTooltip() {
  if (ready) return;
  try {
    const arrests = await loadJSON('arrest_rates');
    arrestRates = new Map(arrests.map(r => [r.type, r.rate]));
  } catch (err) {
    console.warn('tooltip: arrest_rates not available', err);
  }
  if (mapStage) mapStage.addEventListener('mouseleave', hide);
  ready = true;
}

export function bindAreaHover(selection, filterRef, aggregates) {
  selection
    .on('mouseenter', function (event, d) {
      const caId = +d.properties.id;
      const summary = summarise(caId, filterRef(), aggregates);
      fill({
        name: d.properties.name,
        total: summary.total,
        topCategory: summary.topCategory,
        arrestRate: summary.arrestRate,
      });
      show();
      positionAt(event);
    })
    .on('mousemove', positionAt);
}
