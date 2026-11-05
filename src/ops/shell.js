import { OPS_PAGES } from './catalog.js';

/** Shared Cape ops chrome — GEV brand + full desk nav. */
export function mountOpsShell({ page }) {
  const top = document.createElement('header');
  top.className = 'ops-top';
  top.innerHTML = `
    <a class="ops-brand" href="/ops/" translate="no">
      <img src="/logo.svg" alt="" width="22" height="22" />
      <span>GOD'S EYE <span class="accent">VIEW</span> · CAPE OPS</span>
    </a>
    <nav class="ops-nav" aria-label="Ops pages">
      ${OPS_PAGES.map(
        (p) =>
          `<a href="${p.href}"${p.id === page ? ' aria-current="page"' : ''}>${p.label}</a>`,
      ).join('')}
    </nav>
    <a class="ops-globe" href="/">Globe</a>
  `;
  document.body.prepend(top);
}

export function parsePointParams(search = location.search) {
  const params = new URLSearchParams(search);
  const lat = Number(params.get('lat'));
  const lon = Number(params.get('lon') ?? params.get('lng'));
  const z = Number(params.get('z') ?? params.get('zoom'));
  return {
    lat: Number.isFinite(lat) ? lat : null,
    lon: Number.isFinite(lon) ? lon : null,
    z: Number.isFinite(z) ? z : null,
    raw: params,
  };
}

export function setStatus(el, message, tone = '') {
  if (!el) return;
  el.textContent = message || '';
  if (tone) el.dataset.tone = tone;
  else delete el.dataset.tone;
}

/** Cape May County home — matches globe CAPE_HOME. */
export const OPS_HOME = Object.freeze({ lon: -74.91, lat: 38.935, z: 17 });

export function writePointUrl(lat, lon, extra = {}) {
  const url = new URL(location.href);
  url.searchParams.set('lat', String(lat));
  url.searchParams.set('lon', String(lon));
  for (const [key, value] of Object.entries(extra)) {
    if (value == null) url.searchParams.delete(key);
    else url.searchParams.set(key, String(value));
  }
  history.replaceState(null, '', url);
}
