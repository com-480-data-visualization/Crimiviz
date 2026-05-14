export const state = {
  type: 'ALL',
  hour: 'ALL',
};

const listeners = new Set();

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  listeners.forEach(fn => fn(state));
}

export function setType(value) {
  state.type = value || 'ALL';
  emit();
}

export function setHour(value) {
  if (value === null || value === undefined || value === '' || value === 'ALL') {
    state.hour = 'ALL';
  } else {
    state.hour = parseInt(value, 10);
  }
  emit();
}

export function reset() {
  state.type = 'ALL';
  state.hour = 'ALL';
  emit();
}

export function bindControls() {
  const typeEl = document.getElementById('filter-type');
  const hourEl = document.getElementById('filter-hour');
  const resetEl = document.getElementById('filter-reset');

  if (typeEl) {
    typeEl.addEventListener('change', () => setType(typeEl.value));
  }
  if (hourEl) {
    hourEl.addEventListener('input', () => setHour(hourEl.value));
  }
  if (resetEl) {
    resetEl.addEventListener('click', () => {
      if (typeEl) typeEl.value = 'ALL';
      if (hourEl) hourEl.value = 12;
      reset();
    });
  }
}
