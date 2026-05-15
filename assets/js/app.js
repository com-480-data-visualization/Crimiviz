(function(){
  const tabs   = Array.from(document.querySelectorAll('[data-tab]'));
  const links  = Array.from(document.querySelectorAll('[data-tab-link]'));
  const panels = {
    home:     document.getElementById('panel-home'),
    map:      document.getElementById('panel-map'),
    trends:   document.getElementById('panel-trends'),
    insights: document.getElementById('panel-insights'),
  };

  function selectTab(name){
    document.body.dataset.tab = name;
    Object.keys(panels).forEach(k => {
      const p = panels[k];
      if (!p) return;
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
    requestAnimationFrame(applyBleed);
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
    return String(parseInt(h, 10)).padStart(2, '0') + ':00';
  }
  if (hour && hourDisp) {
    hour.addEventListener('input', () => { hourDisp.textContent = fmtHour(hour.value); });
    hourDisp.textContent = fmtHour(hour.value);
  }

  const resetBtn = document.getElementById('filter-reset');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      const typeEl = document.getElementById('filter-type');
      if (typeEl) typeEl.value = 'ALL';
      if (hour) hour.value = 12;
      if (hourDisp) hourDisp.textContent = 'All';
      document.querySelectorAll('.year-pill').forEach(p => p.classList.add('active'));
    });
  }

  const tip = document.getElementById('map-tooltip');
  if (tip) {
    tip.style.display = 'none';
    tip.setAttribute('aria-hidden', 'true');
  }

  const yearGrid = document.getElementById('year-grid');
  const yearsAllBtn = document.getElementById('years-all');
  if (yearGrid) {
    for (let y = 2001; y <= 2026; y++) {
      const btn = document.createElement('button');
      btn.className = 'year-pill active';
      btn.type = 'button';
      btn.dataset.year = String(y);
      btn.textContent = String(y);
      btn.addEventListener('click', () => {
        btn.classList.toggle('active');
        document.dispatchEvent(new CustomEvent('crimiviz:years-changed'));
      });
      yearGrid.appendChild(btn);
    }
  }
  if (yearsAllBtn) {
    yearsAllBtn.addEventListener('click', () => {
      const pills = document.querySelectorAll('.year-pill');
      const anyInactive = Array.from(pills).some(p => !p.classList.contains('active'));
      pills.forEach(p => p.classList.toggle('active', anyInactive));
      document.dispatchEvent(new CustomEvent('crimiviz:years-changed'));
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
  if (tablist) {
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
  }

  window.Crimiviz = window.Crimiviz || {};
  window.Crimiviz.selectTab = selectTab;
  window.Crimiviz.applyBleed = applyBleed;
})();
