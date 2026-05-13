import * as d3 from 'd3';
import * as topojson from 'topojson-client';

window.__crimiviz = { d3, topojson };

const tabs   = Array.from(document.querySelectorAll('[data-tab]'));
const links  = Array.from(document.querySelectorAll('[data-tab-link]'));
const panels = {
  home:     document.getElementById('panel-home'),
  map:      document.getElementById('panel-map'),
  trends:   document.getElementById('panel-trends'),
  insights: document.getElementById('panel-insights'),
};

export function selectTab(name){
  document.body.dataset.tab = name;
  Object.keys(panels).forEach(k => {
    const p = panels[k];
    const isActive = (k === name);
    p.classList.toggle('is-active', isActive);
    if (isActive) {
      p.removeAttribute('hidden');
      p.querySelectorAll('.stagger').forEach(s => {
        s.classList.remove('stagger');
        void s.offsetWidth;
        s.classList.add('stagger');
      });
    } else {
      p.setAttribute('hidden', '');
    }
  });
  tabs.forEach(t => {
    const isActive = t.dataset.tab === name;
    if (t.getAttribute('role') === 'tab') {
      t.setAttribute('aria-selected', isActive ? 'true' : 'false');
    }
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

tabs.forEach(t => {
  t.addEventListener('click', e => {
    e.preventDefault();
    selectTab(t.dataset.tab);
  });
});

links.forEach(l => {
  l.addEventListener('click', e => {
    e.preventDefault();
    selectTab(l.dataset.tabLink);
  });
});

const hour = document.getElementById('filter-hour');
const hourDisp = document.getElementById('hour-display');

function fmtHour(h){
  const n = parseInt(h, 10);
  return String(n).padStart(2, '0') + ':00';
}

hour.addEventListener('input', () => { hourDisp.textContent = fmtHour(hour.value); });
hourDisp.textContent = fmtHour(hour.value);

document.getElementById('filter-reset').addEventListener('click', () => {
  document.getElementById('filter-type').value = 'ALL';
  hour.value = 12;
  hourDisp.textContent = fmtHour(hour.value);
});

const mapStage = document.querySelector('.map-stage');
const tip = document.getElementById('map-tooltip');
if (mapStage && tip) {
  mapStage.addEventListener('mousemove', (e) => {
    const r = mapStage.getBoundingClientRect();
    tip.style.display = 'block';
    tip.setAttribute('aria-hidden', 'false');
    const x = e.clientX - r.left + 16;
    const y = e.clientY - r.top + 16;
    tip.style.left = Math.min(x, r.width  - 220) + 'px';
    tip.style.top  = Math.min(y, r.height - 130) + 'px';
  });
  mapStage.addEventListener('mouseleave', () => {
    tip.style.display = 'none';
    tip.setAttribute('aria-hidden', 'true');
  });
}

const drips = Array.from(document.querySelectorAll('.drip'));
const kpiBleeds = Array.from(document.querySelectorAll('[data-kpi-bleed]'));

function setDrip(el, h){
  el.style.height = h + 'px';
}

function applyBleed(){
  const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
  const p = Math.min(1, Math.max(0, window.scrollY / max));
  drips.forEach(d => {
    const cs = getComputedStyle(d);
    const base  = parseFloat(cs.getPropertyValue('--base'))  || 80;
    const extra = parseFloat(cs.getPropertyValue('--extra')) || 400;
    const top = parseFloat(cs.top) || 0;
    const isCorner = d.classList.contains('drip-left') || d.classList.contains('drip-right');
    if (isCorner) {
      const target = Math.max(base, window.innerHeight - top - 4);
      setDrip(d, base + (target - base) * p);
    } else {
      const eased = 1 - Math.pow(1 - p, 1.6);
      setDrip(d, base + extra * eased);
    }
  });
  kpiBleeds.forEach(b => {
    const cs = getComputedStyle(b);
    const base  = parseFloat(cs.getPropertyValue('--base'))  || 18;
    const extra = parseFloat(cs.getPropertyValue('--extra')) || 40;
    const r = b.getBoundingClientRect();
    const vis = Math.min(1, Math.max(0, 1 - r.top / window.innerHeight));
    const eased = 1 - Math.pow(1 - vis, 1.4);
    setDrip(b, base + extra * eased);
  });
}

let ticking = false;
function onScroll(){
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => { applyBleed(); ticking = false; });
}

window.addEventListener('scroll', onScroll, { passive: true });
window.addEventListener('resize', applyBleed);
applyBleed();

const tablist = document.querySelector('[role="tablist"]');
tablist.addEventListener('keydown', (e) => {
  const order = ['home', 'map', 'trends', 'insights'];
  const current = document.querySelector('.tab[aria-selected="true"]').dataset.tab;
  let i = order.indexOf(current);
  if (e.key === 'ArrowRight') i = (i + 1) % order.length;
  else if (e.key === 'ArrowLeft') i = (i - 1 + order.length) % order.length;
  else return;
  selectTab(order[i]);
  document.querySelector('.tab[data-tab="' + order[i] + '"]').focus();
});
