const cache = new Map();
const inflight = new Map();

export async function loadJSON(name) {
  if (cache.has(name)) return cache.get(name);
  if (inflight.has(name)) return inflight.get(name);

  const promise = fetch(`data/${name}.json`).then(r => {
    if (!r.ok) throw new Error(`failed to load ${name}.json (${r.status})`);
    return r.json();
  }).then(payload => {
    cache.set(name, payload);
    inflight.delete(name);
    return payload;
  });

  inflight.set(name, promise);
  return promise;
}

export function preload(...names) {
  return Promise.all(names.map(loadJSON));
}
