export const CAPE_RADIO_OPEN_EVENT = 'gev:cape-radio-open';

/**
 * Ask the RADIO panel to play a Fire Wire scanner feed or CAD clip.
 * @param {{ feedId?: string, audioUrl?: string, name?: string, agency?: string, lat?: number, lon?: number }} detail
 * @param {EventTarget} [eventTarget]
 * @returns {boolean}
 */
export function requestCapeRadio(detail = {}, eventTarget = globalThis.window) {
  if (typeof eventTarget?.dispatchEvent !== 'function') return false;
  const feedId =
    detail.feedId != null && String(detail.feedId).trim()
      ? String(detail.feedId).trim()
      : '';
  const audioUrl =
    detail.audioUrl != null && String(detail.audioUrl).trim()
      ? String(detail.audioUrl).trim()
      : '';
  if (!feedId && !audioUrl) return false;
  eventTarget.dispatchEvent(
    new CustomEvent(CAPE_RADIO_OPEN_EVENT, {
      detail: {
        feedId,
        audioUrl,
        name: detail.name ? String(detail.name) : '',
        agency: detail.agency ? String(detail.agency) : '',
        lat: Number.isFinite(detail.lat) ? detail.lat : null,
        lon: Number.isFinite(detail.lon) ? detail.lon : null,
      },
    }),
  );
  return true;
}

/**
 * Enable radio, open the panel, and hand the request to the layer player.
 * @param {CustomEvent|Object} event
 * @param {{ enabled?: () => boolean, enable?: () => Promise<*>, playCape?: (detail: object) => Promise<*>|*, openPanel?: () => void }} deps
 * @returns {Promise<boolean>}
 */
export async function openCapeRadioFromRequest(
  event,
  { enabled, enable, playCape, openPanel } = {},
) {
  const detail = event?.detail;
  if (!detail || typeof playCape !== 'function') return false;
  if (
    typeof enabled === 'function' &&
    !enabled() &&
    typeof enable === 'function'
  )
    await enable();
  openPanel?.();
  const started = await playCape(detail);
  return started !== false;
}
