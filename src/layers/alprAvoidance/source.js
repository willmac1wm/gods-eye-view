// A source module (no browser globals, see check:boundaries), so no i18n
// import: failures stay English here and the layer translates them on show.
const msg = (text) => text;

import {
  ALPR_AVOIDANCE_MAX_ALTERNATIVES,
  ALPR_AVOIDANCE_PROFILE,
  ALPR_AVOIDANCE_ROUTE,
} from './policy.js';
import {
  pickFastestAndLowest,
  scoreRoutes,
  validateSnapshot,
} from './records.js';

/** Build the alternatives query for the route proxy. */
export function alprAvoidanceRequestUrl(a, b) {
  const coords = `${a.lon.toFixed(6)},${a.lat.toFixed(6)};${b.lon.toFixed(6)},${b.lat.toFixed(6)}`;
  return `${ALPR_AVOIDANCE_ROUTE}?profile=${encodeURIComponent(ALPR_AVOIDANCE_PROFILE)}&coords=${encodeURIComponent(coords)}&alternatives=1`;
}

/**
 * Acquire scored route alternatives for the Directions layer's endpoints.
 * The ALPR layer's analyst records are the only camera input: locations, not
 * reads or feeds. When the ALPR layer holds no records the routes are still
 * returned, but the exposure is unknown — an empty camera list never scores
 * as zero cameras, because the ALPR layer is viewport-gated and may simply
 * not have loaded the route's area.
 *
 * The route fetch is keyed on the endpoints: moving A or B fetches new
 * alternatives, but a tick with the same endpoints re-scores the cached
 * routes against the current camera list in memory — the 15 s layer tick
 * costs no network unless the endpoints moved, and the score stays live
 * to cameras the ALPR layer loads as the user pans.
 * @param {object} options
 * @param {Function} options.readLayers Lazy accessor for the other layers.
 * @param {Function} options.fetchImpl Injected request function.
 * @param {string} options.route Route-proxy path (default /api/route).
 * @returns {{getSnapshot: Function}}
 */
export function createAlprAvoidanceSource({
  readLayers,
  fetchImpl = (...args) => globalThis.fetch(...args),
  route = ALPR_AVOIDANCE_ROUTE,
} = {}) {
  let _lastKey = null;
  let _lastRoutes = null;

  return {
    async getSnapshot({ signal, force = false } = {}) {
      signal?.throwIfAborted();
      let endpoints = null;
      try {
        endpoints = readLayers?.()?.directions?.getEndpoints?.() ?? null;
      } catch {
        endpoints = null;
      }
      const a = endpoints?.a;
      const b = endpoints?.b;
      if (!a || !b) {
        _lastKey = null;
        _lastRoutes = null;
        return {
          available: false,
          reason: 'no-endpoints',
          routes: [],
          fastestIndex: -1,
          lowestIndex: -1,
          camerasConsidered: 0,
          alprAvailable: false,
          alprStale: false,
          alprSaturated: false,
          fetchedAt: Date.now(),
        };
      }

      // The ALPR layer's own records, read through its analyst seam. [] while
      // the layer is off or while it has loaded nothing for its viewport.
      let cameras = [];
      let alprStats = null;
      try {
        const alpr = readLayers?.()?.alpr;
        cameras = alpr?.getAnalystRecords?.() ?? [];
        alprStats = alpr?.getStats?.() ?? null;
      } catch {
        cameras = [];
        alprStats = null;
      }
      const alprAvailable = cameras.length > 0;
      const alprStale = Boolean(alprStats?.stale);
      const alprSaturated = Boolean(alprStats?.saturated);

      const key = `${a.lat.toFixed(6)},${a.lon.toFixed(6)};${b.lat.toFixed(6)},${b.lon.toFixed(6)}`;
      if (force || key !== _lastKey || !_lastRoutes) {
        const query = alprAvoidanceRequestUrl(a, b).split('?')[1];
        const response = await fetchImpl(`${route}?${query}`, {
          signal,
          headers: { Accept: 'application/json' },
        });
        const payload = await response.json();
        signal?.throwIfAborted();
        if (response.status === 429) {
          const refusal =
            typeof payload?.error === 'string' && payload.error
              ? payload.error
              : null;
          throw Object.assign(
            new Error(
              refusal
                ? `${refusal} — try again in a moment`
                : msg('Routing is rate limited — try again in a moment'),
            ),
            { status: 429, refusal },
          );
        }
        if (!response.ok || !payload?.ok)
          throw Object.assign(
            new Error(
              payload?.error
                ? `Routing unavailable — ${payload.error}`
                : `Routing unavailable (HTTP ${response.status})`,
            ),
            { status: response.status },
          );
        const alternatives = Array.isArray(payload.alternatives)
          ? payload.alternatives
          : [payload];
        _lastRoutes = alternatives.slice(0, ALPR_AVOIDANCE_MAX_ALTERNATIVES);
        _lastKey = key;
      }
      const scored = scoreRoutes(_lastRoutes, cameras);
      const { fastestIndex, lowestIndex, sameRoute } =
        pickFastestAndLowest(scored);
      const snapshot = {
        available: true,
        reason: null,
        a,
        b,
        routes: scored,
        fastestIndex,
        lowestIndex,
        sameRoute,
        camerasConsidered: cameras.length,
        alprAvailable,
        alprStale,
        alprSaturated,
        fetchedAt: Date.now(),
      };
      const errors = validateSnapshot(snapshot);
      if (errors.length)
        throw new Error(`Invalid snapshot: ${errors.join('; ')}`);
      return snapshot;
    },
  };
}
