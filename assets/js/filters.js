const ALL_YEARS = Array.from({ length: 26 }, (_, i) => 2001 + i);

export const state = {
  type: 'ALL',
  hour: 'ALL',
  years: new Set(ALL_YEARS),
};

export function setYears(years) {
  state.years = years instanceof Set ? years : new Set(years);
  emit();
}

export function isAllYears() {
  return state.years.size === ALL_YEARS.length;
}

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
  state.years = new Set(ALL_YEARS);
  emit();
}
