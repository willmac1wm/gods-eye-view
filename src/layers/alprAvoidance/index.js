// src/layers/alprAvoidance/index.js
import { t } from '../../i18n/index.js';
import {
  createAlprAvoidanceSummaryEntry,
  getAnalystRecords,
  routeMinutes,
} from './model.js';
import {
  ALPR_AVOIDANCE_ATTRIBUTION,
  ALPR_AVOIDANCE_LAYER_ID,
  ALPR_AVOIDANCE_OVERLAY_COHORT_LIMIT,
  ALPR_AVOIDANCE_OVERLAY_SOURCE_ID,
  ALPR_AVOIDANCE_REFRESH_MS,
} from './policy.js';
import { createAlprAvoidanceRendering } from './rendering.js';
export * from './model.js';
export { createAlprAvoidanceSource } from './source.js';
export * from './records.js';

// A portable package (no i18n): the error stays English data and the layer
// panel shows it translated.
const msg = (text) => text;

/**
 * Own one ALPR-avoidance display and its refresh lifecycle.
 *
 * The user places A and B in the Directions layer; this layer asks the
 * route proxy for up to 3 alternatives for those endpoints and scores each
 * against the ALPR layer's mapped camera LOCATIONS (within 90 m of the
 * polyline — the ALPR layer's direction-cone radius). The fastest route
 * draws solid blue, the lowest-exposure route dashed green, with a dot at
 * each known camera on each route. No plate reads, no live feeds, no facial
 * recognition — locations only, and "known cameras" is the honest wording:
 * the ALPR layer holds mapped locations for its viewport, not a census.
 * When the ALPR layer holds no records the routes still show, but the
 * exposure is unknown instead of scored as zero. v1 ships car only.
 */
export function createAlprAvoidanceLayer({
  source,
  overlayHost,
  rendering = createAlprAvoidanceRendering(),
  now = () => Date.now(),
} = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('ALPR avoidance requires a snapshot source');
  if (!overlayHost)
    throw new TypeError('ALPR avoidance requires an overlay host');
  let _viewer = null;
  let _snapshot = null;
  let _lastUpdate = null;
  let _lastError = null;
  let _stale = false;
  let _enabled = false;
  let _refreshing = null;
  let rowControlsListener = null;

  const notify = () => rowControlsListener?.();

  function applyEntries() {
    if (!_enabled) return;
    const entries = [];
    if (_snapshot)
      entries.push(createAlprAvoidanceSummaryEntry({ snapshot: _snapshot }));
    overlayHost.setEntries(ALPR_AVOIDANCE_OVERLAY_SOURCE_ID, entries, {
      cohortLimit: ALPR_AVOIDANCE_OVERLAY_COHORT_LIMIT + 1,
      moving: false,
    });
  }

  function applyRendering() {
    if (!_enabled) return;
    if (_snapshot?.available) {
      rendering.show({
        fastest: _snapshot.routes?.[_snapshot.fastestIndex],
        lowest: _snapshot.routes?.[_snapshot.lowestIndex],
        sameRoute: _snapshot.sameRoute,
      });
    } else {
      rendering.hide();
    }
  }

  async function refresh({ force = false } = {}) {
    if (!_enabled) return false;
    if (_refreshing) return _refreshing;
    _refreshing = (async () => {
      try {
        const snapshot = await source.getSnapshot({ force });
        _snapshot = snapshot;
        _stale = snapshot?.alprStale === true;
        applyEntries();
        applyRendering();
        _lastUpdate = now();
        _lastError = null;
        console.log(
          `[Data:AlprAvoidance] Updated: ${snapshot?.routes?.length ?? 0} route(s)` +
            (snapshot?.alprAvailable
              ? ` against ${snapshot.camerasConsidered} known cameras`
              : ' (camera data unavailable)') +
            (_stale ? ' (camera data stale)' : ''),
        );
        notify();
        return true;
      } catch (e) {
        console.warn('[Data:AlprAvoidance] Fetch error:', e);
        _lastError = e?.message || msg('Routing unavailable');
        notify();
        return false;
      } finally {
        _refreshing = null;
      }
    })();
    return _refreshing;
  }

  const layer = {
    id: ALPR_AVOIDANCE_LAYER_ID,
    name: 'ALPR-avoidance routing',
    icon: '🛣️',
    source: ALPR_AVOIDANCE_ATTRIBUTION,
    updateInterval: ALPR_AVOIDANCE_REFRESH_MS,

    init(viewer) {
      if (_viewer)
        throw new Error('ALPR-avoidance layer is already initialized');
      _viewer = viewer;
      _snapshot = null;
      _lastUpdate = null;
      _lastError = null;
      _stale = false;
      _enabled = false;
      rowControlsListener = null;
      rendering.setScene({ viewer });
      overlayHost.setVisible(ALPR_AVOIDANCE_OVERLAY_SOURCE_ID, false);
      console.log('[Data:AlprAvoidance] Initialized');
    },

    enable(viewer) {
      _enabled = true;
      if (viewer) rendering.setScene({ viewer });
      overlayHost.setVisible(ALPR_AVOIDANCE_OVERLAY_SOURCE_ID, true);
      void refresh();
    },

    disable(viewer) {
      _enabled = false;
      rendering.hide();
      overlayHost.clearSource(ALPR_AVOIDANCE_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(ALPR_AVOIDANCE_OVERLAY_SOURCE_ID, false);
    },

    async update(viewer) {
      if (!_enabled) return false;
      return refresh();
    },

    destroy(viewer = _viewer) {
      _viewer = null;
      _enabled = false;
      rendering.destroy();
      overlayHost.clearSource(ALPR_AVOIDANCE_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(ALPR_AVOIDANCE_OVERLAY_SOURCE_ID, false);
      _snapshot = null;
      _lastUpdate = null;
      _lastError = null;
      _stale = false;
      rowControlsListener = null;
    },

    /**
     * Params lane: { refresh: true } forces a new route fetch even when the
     * endpoints have not moved (the source otherwise re-scores its cached
     * routes in memory).
     */
    setParams(params = {}, { origin } = {}) {
      if (params?.refresh === true) {
        if (_enabled) void refresh({ force: true });
        notify();
        return true;
      }
      return false;
    },

    /**
     * Row controls: a refresh chip, an info line (fastest vs lowest
     * exposure, or the placement guidance / camera-data note), and the
     * scored routes — fastest first, then the lowest-exposure alternative
     * when it is a different route.
     */
    getRowControls() {
      const snapshot = _snapshot;
      const fastest = snapshot?.routes?.[snapshot.fastestIndex];
      const lowest = snapshot?.routes?.[snapshot.lowestIndex];
      const info = !snapshot
        ? t('Routing unavailable')
        : !snapshot.available
          ? t('Place A and B in the Directions layer')
          : snapshot.alprAvailable
            ? snapshot.sameRoute
              ? `${t('Fastest')}: ${routeMinutes(fastest)} ${t('min')} · ${fastest.cameraCount} ${t('known cameras')} — ${t('also the lowest-exposure route')}`
              : `${t('Fastest')}: ${routeMinutes(fastest)} ${t('min')} · ${fastest.cameraCount} ${t('known cameras')} — ${t('Lowest exposure')}: ${routeMinutes(lowest)} ${t('min')} · ${lowest.cameraCount} ${t('known cameras')}`
            : `${t('Fastest')}: ${routeMinutes(fastest)} ${t('min')} · ${t('camera data unavailable')}`;
      const items = [];
      if (snapshot?.available) {
        const routeText = (route, extra) =>
          `${(route.distanceM / 1000).toFixed(1)} ${t('km')} · ` +
          (snapshot.alprAvailable
            ? `${route.cameraCount} ${t('known cameras')}`
            : t('camera data unavailable')) +
          (extra ? ` · ${extra}` : '');
        items.push({
          id: 'fastest',
          ordinal: 1,
          lead: `${t('Fastest')} · ${routeMinutes(fastest)} ${t('min')}`,
          text: routeText(fastest),
          disabled: true,
        });
        if (!snapshot.sameRoute) {
          const extraMinutes = routeMinutes(lowest) - routeMinutes(fastest);
          items.push({
            id: 'lowest',
            ordinal: 2,
            lead: `${t('Lowest exposure')} · ${routeMinutes(lowest)} ${t('min')}`,
            text: routeText(
              lowest,
              extraMinutes > 0
                ? `+${extraMinutes} ${t('min')}`
                : t('same time'),
            ),
            disabled: true,
          });
        }
      }
      return {
        chips: [
          {
            id: 'refresh',
            label: t('Refresh routes'),
            title: t('Fetch fresh route alternatives for the current A and B'),
            disabled: !snapshot?.available,
            params: { refresh: true },
          },
        ],
        info,
        infoTitle: t(
          'Routes for the Directions layer’s A and B, scored against the ALPR layer’s mapped camera locations only — no plate reads, no live feeds, no facial recognition. “Known cameras” means cameras the ALPR layer has loaded for its viewport; a route with 0 known cameras may still pass cameras the layer has not loaded. Car only in v1.',
        ),
        legend: null,
        list: {
          ariaLabel: t('Scored route alternatives'),
          items,
        },
      };
    },

    setRowControlsListener(listener) {
      rowControlsListener = typeof listener === 'function' ? listener : null;
    },

    /**
     * Snapshot the scored routes as plain JSON-safe objects for the analyst
     * query engine. On-demand only — zero per-frame cost, no listeners, no
     * caching. Returns [] while disabled or empty.
     * @param {number} [maxCount=2000] - Maximum records to return.
     * @returns {Array<Object>} See mapAnalystRecord for the record shape.
     */
    getAnalystRecords(maxCount = 2000) {
      if (!_enabled || !_snapshot) return [];
      const limit = Number.isFinite(maxCount)
        ? Math.max(1, Math.floor(maxCount))
        : 2000;
      return getAnalystRecords(_snapshot).slice(0, limit);
    },

    getStats() {
      return {
        count: _snapshot?.routes?.length ?? 0,
        fastestIndex: _snapshot?.fastestIndex ?? -1,
        lowestIndex: _snapshot?.lowestIndex ?? -1,
        sameRoute: _snapshot?.sameRoute ?? false,
        camerasConsidered: _snapshot?.camerasConsidered ?? 0,
        alprAvailable: _snapshot?.alprAvailable ?? false,
        alprStale: _snapshot?.alprStale ?? false,
        alprSaturated: _snapshot?.alprSaturated ?? false,
        rendering: rendering.getState(),
        lastUpdate: _lastUpdate,
        error: _lastError,
        stale: _stale,
      };
    },
  };
  return layer;
}
