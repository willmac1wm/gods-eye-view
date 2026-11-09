/**
 * The shared details window. Opens for any map item a local-awareness layer
 * registered (see registry.js) or when a list (calls, alerts, County page)
 * asks for a record. Shows only what the record actually has — missing
 * fields are left out, never guessed — plus its source and timestamps.
 */
import * as Cesium from 'cesium';
import { DETAILS_ID_PREFIX, lookupDetails, onOpenDetails } from './registry.js';
import { escapeHtml, statusBadge, whenText, relativeTime } from './format.js';

let root = null;
let viewer = null;
let handler = null;
let lastFocus = null;
let currentRecord = null;

function badgeHtml(status) {
  const b = statusBadge(status);
  return `<span class="gev-local-badge" data-tone="${b.tone}">${escapeHtml(b.text)}</span>`;
}

function render(record) {
  const fields = (record.fields || []).filter(
    ([, v]) => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length),
  );
  const observed = record.observedAt ? whenText(record.observedAt) : null;
  const fetched = record.fetchedAt ? relativeTime(record.fetchedAt) : null;
  const canFly = Number.isFinite(record.lat) && Number.isFinite(record.lon) && viewer;
  root.innerHTML = `
    <header class="gev-local-details-head">
      <div>
        <span class="gev-local-kicker">${escapeHtml(record.kindLabel || 'Details')}</span>
        <h2 id="gev-local-details-title">${escapeHtml(record.title || 'Untitled')}</h2>
        ${record.subtitle ? `<p class="gev-local-sub">${escapeHtml(record.subtitle)}</p>` : ''}
        <div class="gev-local-status-row">${badgeHtml(record.status)}${
          observed ? `<span class="gev-local-time">${escapeHtml(record.timeLabel || 'Observed')} ${escapeHtml(observed)}</span>` : ''
        }</div>
      </div>
      <button type="button" class="gev-local-close" aria-label="Close details" data-act="close">×</button>
    </header>
    <div class="gev-local-details-body ui-scroll">
      ${record.note ? `<p class="gev-local-note">${escapeHtml(record.note)}</p>` : ''}
      ${record.instruction ? `<div class="gev-local-instruction"><strong>Instructions from the issuer</strong><p>${escapeHtml(record.instruction)}</p></div>` : ''}
      ${fields.length ? `<dl class="gev-local-fields">${fields.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(Array.isArray(v) ? v.join(', ') : v)}</dd>`).join('')}</dl>` : ''}
      ${record.imageUrl ? `<img class="gev-local-image" src="${escapeHtml(record.imageUrl)}" alt="${escapeHtml(record.imageAlt || record.title || '')}" loading="lazy" />` : ''}
      ${record.audioUrl ? `<div class="gev-local-audio"><span class="gev-local-label">Audio clip</span><audio controls preload="none" src="${escapeHtml(record.audioUrl)}"></audio></div>` : ''}
      ${record.transcript ? `<div class="gev-local-transcript"><span class="gev-local-label">Transcript</span><blockquote>${escapeHtml(record.transcript)}</blockquote>${record.transcriptNote ? `<small>${escapeHtml(record.transcriptNote)}</small>` : ''}</div>` : ''}
      ${record.description ? `<div class="gev-local-description"><span class="gev-local-label">Details</span><p>${escapeHtml(record.description)}</p></div>` : ''}
    </div>
    <footer class="gev-local-details-foot">
      <div class="gev-local-source">Source: ${
        record.sourceUrl
          ? `<a href="${escapeHtml(record.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(record.source || 'unknown')}</a>`
          : escapeHtml(record.source || 'unknown')
      }${fetched ? ` · fetched ${escapeHtml(fetched)}` : ''}</div>
      <div class="gev-local-actions">
        ${canFly ? '<button type="button" class="gev-local-btn" data-act="fly">Fly to</button>' : ''}
        ${record.link ? `<a class="gev-local-btn" href="${escapeHtml(record.link)}" target="_blank" rel="noopener noreferrer">Open source ↗</a>` : ''}
      </div>
    </footer>`;
}

export function openRecord(record) {
  if (!root || !record) return;
  currentRecord = record;
  if (root.hidden) lastFocus = document.activeElement;
  render(record);
  root.hidden = false;
  root.querySelector('[data-act="close"]')?.focus();
}

export function closeDetails() {
  if (!root || root.hidden) return;
  root.querySelector('audio')?.pause();
  root.hidden = true;
  currentRecord = null;
  if (lastFocus && document.contains(lastFocus)) lastFocus.focus?.();
}

/**
 * Mount the window once for the application lifetime.
 * @param {{viewer: Cesium.Viewer}} options
 * @returns {() => void} destroy
 */
export function initDetailsPanel({ viewer: v }) {
  viewer = v;
  root = document.createElement('section');
  root.id = 'gev-local-details';
  root.className = 'gev-local-panel';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-labelledby', 'gev-local-details-title');
  root.hidden = true;
  document.body.appendChild(root);

  root.addEventListener('click', (event) => {
    const act = event.target.closest('[data-act]')?.dataset.act;
    if (act === 'close') closeDetails();
    if (act === 'fly' && currentRecord) {
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(currentRecord.lon, currentRecord.lat, currentRecord.flyHeight || 3500),
        orientation: { heading: 0, pitch: Cesium.Math.toRadians(-60), roll: 0 },
        duration: 1.8,
      });
    }
  });
  const onKey = (event) => {
    if (event.key === 'Escape' && !root.hidden) {
      event.stopPropagation();
      closeDetails();
    }
  };
  document.addEventListener('keydown', onKey, true);

  // Only our own entities open the window; every other layer keeps its
  // existing click behaviour.
  handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  handler.setInputAction((click) => {
    const picked = viewer.scene.pick(click.position);
    const id = picked?.id?.id ?? picked?.id;
    if (typeof id === 'string' && id.startsWith(DETAILS_ID_PREFIX)) {
      const record = lookupDetails(id);
      if (record) openRecord(record);
    }
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  const off = onOpenDetails(openRecord);
  return () => {
    off();
    document.removeEventListener('keydown', onKey, true);
    handler?.destroy();
    handler = null;
    root?.remove();
    root = null;
  };
}
