// src/layers/satelliteVerification/index.js
import { t } from '../../i18n/index.js';
import {
  createSatelliteCompareEntry,
  createSatelliteSummaryEntry,
  mapAnalystRecord,
} from './model.js';
import {
  SATELLITE_COMPARE_DAYS_BACK,
  SATELLITE_DATE_CHIPS,
  SATELLITE_OVERLAY_COHORT_LIMIT,
  SATELLITE_VERIFICATION_ATTRIBUTION,
  SATELLITE_VERIFICATION_LAYER_ID,
  SATELLITE_VERIFICATION_OVERLAY_SOURCE_ID,
  SATELLITE_VERIFICATION_REFRESH_MS,
} from './policy.js';
import { addDays, isValidDateString, toDateString } from './records.js';
import { createSatelliteDrape } from './rendering.js';
export * from './model.js';
export { createSatelliteVerificationSource } from './source.js';
export * from './records.js';

// A portable package (no i18n): the error stays English data and the layer
// panel shows it translated.
const msg = (text) => text;

/**
 * Own one satellite-verification display and its refresh lifecycle.
 *
 * The source probes GIBS true-color tiles (Terra → Aqua → NOAA20) for the
 * active date and the Copernicus OData catalogue for the newest
 * Sentinel-2 products over the county; the layer drapes the winning
 * tile pyramid over the county rectangle and lists the products. The
 * compare (B) date drapes alongside at half alpha. A date with no
 * imagery says so and offers the nearest available date — never a
 * neighbouring date's tile presented as the requested date. MODIS
 * true-color lags ~3–6 h behind acquisition; the layer states the lag.
 */
export function createSatelliteVerificationLayer({
  source,
  overlayHost,
  drape = createSatelliteDrape(),
  openUrl = (url) => globalThis.open?.(url, '_blank'),
  now = () => Date.now(),
} = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('Satellite verification requires a snapshot source');
  if (!overlayHost)
    throw new TypeError('Satellite verification requires an overlay host');
  let _viewer = null;
  let _snapshotA = null;
  let _snapshotB = null;
  let _dateA = null; // null = latest available
  let _dateB = null; // null = 7 days before the active date
  let _showB = false;
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
    if (_snapshotA)
      entries.push(createSatelliteSummaryEntry({ snapshot: _snapshotA }));
    if (_showB && _snapshotB) {
      const compare = createSatelliteCompareEntry({ snapshot: _snapshotB });
      if (compare) entries.push(compare);
    }
    overlayHost.setEntries(SATELLITE_VERIFICATION_OVERLAY_SOURCE_ID, entries, {
      cohortLimit: SATELLITE_OVERLAY_COHORT_LIMIT + 1,
      moving: false,
    });
  }

  function applyDrapes() {
    if (!_enabled) return;
    if (_snapshotA?.tileUrlTemplate) {
      drape.show('a', {
        template: _snapshotA.tileUrlTemplate,
        credit: SATELLITE_VERIFICATION_ATTRIBUTION,
        alpha: 1,
      });
    } else {
      drape.hide('a');
    }
    if (_showB && _snapshotB?.tileUrlTemplate) {
      drape.show('b', {
        template: _snapshotB.tileUrlTemplate,
        credit: SATELLITE_VERIFICATION_ATTRIBUTION,
        alpha: 0.5,
      });
    } else {
      drape.hide('b');
    }
  }

  async function refresh() {
    if (!_enabled) return false;
    if (_refreshing) return _refreshing;
    _refreshing = (async () => {
      try {
        const snapshotA = await source.getSnapshot({
          date: _dateA ?? undefined,
        });
        _snapshotA = snapshotA;
        _snapshotB = null;
        if (_showB) {
          // A B failure never loses the good A snapshot — the compare
          // drape just stays off until the next refresh.
          try {
            const dateB =
              _dateB ?? addDays(snapshotA.date, -SATELLITE_COMPARE_DAYS_BACK);
            _snapshotB = await source.getSnapshot({ date: dateB });
          } catch (error) {
            console.warn(
              '[Data:SatelliteVerification] Compare fetch error:',
              error,
            );
            _snapshotB = null;
          }
        }
        _stale = _snapshotA?.catalogueAvailable === false;
        applyEntries();
        applyDrapes();
        _lastUpdate = now();
        _lastError = null;
        console.log(
          `[Data:SatelliteVerification] Updated: ${_snapshotA?.date ?? 'none'} via ${_snapshotA?.source ?? 'none'}${_stale ? ' (catalogue unavailable)' : ''}`,
        );
        notify();
        return true;
      } catch (e) {
        console.warn('[Data:SatelliteVerification] Fetch error:', e);
        _lastError = e?.message || msg('Satellite imagery unavailable');
        notify();
        return false;
      } finally {
        _refreshing = null;
      }
    })();
    return _refreshing;
  }

  const layer = {
    id: SATELLITE_VERIFICATION_LAYER_ID,
    name: 'Satellite verification',
    icon: '🛰️',
    source: SATELLITE_VERIFICATION_ATTRIBUTION,
    updateInterval: SATELLITE_VERIFICATION_REFRESH_MS,

    init(viewer) {
      if (_viewer)
        throw new Error('Satellite verification layer is already initialized');
      _viewer = viewer;
      _snapshotA = null;
      _snapshotB = null;
      _dateA = null;
      _dateB = null;
      _showB = false;
      _lastUpdate = null;
      _lastError = null;
      _stale = false;
      _enabled = false;
      rowControlsListener = null;
      drape.setScene({ viewer });
      overlayHost.setVisible(SATELLITE_VERIFICATION_OVERLAY_SOURCE_ID, false);
      console.log('[Data:SatelliteVerification] Initialized');
    },

    enable(viewer) {
      _enabled = true;
      if (viewer) drape.setScene({ viewer });
      overlayHost.setVisible(SATELLITE_VERIFICATION_OVERLAY_SOURCE_ID, true);
      void refresh();
    },

    disable(viewer) {
      _enabled = false;
      drape.hide('a');
      drape.hide('b');
      overlayHost.clearSource(SATELLITE_VERIFICATION_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(SATELLITE_VERIFICATION_OVERLAY_SOURCE_ID, false);
    },

    async update(viewer) {
      if (!_enabled) return false;
      return refresh();
    },

    destroy(viewer = _viewer) {
      _viewer = null;
      _enabled = false;
      drape.destroy();
      overlayHost.clearSource(SATELLITE_VERIFICATION_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(SATELLITE_VERIFICATION_OVERLAY_SOURCE_ID, false);
      _snapshotA = null;
      _snapshotB = null;
      _dateA = null;
      _dateB = null;
      _showB = false;
      _lastUpdate = null;
      _lastError = null;
      _stale = false;
      rowControlsListener = null;
    },

    /**
     * Params lane: date chips set the active date via { dateA: 'YYYY-MM-DD' }
     * (or { latest: true } to go back to the newest available); the compare
     * chip toggles { showB }; a Sentinel product jumps the compare date to
     * its sensing date via { dateB } (which also shows the compare drape).
     */
    setParams(params = {}, { origin } = {}) {
      if (params?.latest === true) {
        if (_dateA === null) return false;
        _dateA = null;
        if (_enabled) void refresh();
        notify();
        return true;
      }
      if (isValidDateString(params?.dateA)) {
        if (params.dateA === _dateA) return false;
        _dateA = params.dateA;
        if (_enabled) void refresh();
        notify();
        return true;
      }
      if (isValidDateString(params?.dateB)) {
        if (params.dateB === _dateB && _showB) return false;
        _dateB = params.dateB;
        _showB = true;
        if (_enabled) void refresh();
        notify();
        return true;
      }
      if (typeof params?.showB === 'boolean') {
        if (params.showB === _showB) return false;
        _showB = params.showB;
        if (_enabled) void refresh();
        notify();
        return true;
      }
      return false;
    },

    /**
     * Row controls: date chips for the active date, a compare toggle, an
     * info line (date + source + tile status + catalogue note), and the
     * newest Sentinel-2 products — click one to compare that sensing
     * date against the active date. Worldview and Copernicus Browser
     * open pre-framed to the county + active date.
     */
    getRowControls() {
      const snapshot = _snapshotA;
      const info = snapshot
        ? `${snapshot.date} · ${snapshot.source ?? t('No imagery')}` +
          (snapshot.tileStatus === 'nearest'
            ? ` · ${t('nearest to')} ${snapshot.requestedDate}`
            : '') +
          (snapshot.catalogueAvailable
            ? ` · ${snapshot.products?.length ?? 0} ${t('Sentinel-2 products')}`
            : ` · ${t('Sentinel-2 catalogue unavailable')}`)
        : t('Satellite imagery unavailable');
      const products = snapshot?.products ?? [];
      return {
        chips: [
          ...SATELLITE_DATE_CHIPS.map((chip) => ({
            id: `date-${chip.id}`,
            label: t(chip.label),
            title:
              chip.id === 'latest'
                ? t('Newest available imagery')
                : chip.daysBack === 1
                  ? t('Imagery from yesterday')
                  : t('Imagery from {n} days ago', { n: chip.daysBack }),
            disabled:
              chip.id === 'latest'
                ? _dateA === null
                : _dateA ===
                  addDays(toDateString(new Date(now())), -chip.daysBack),
            params:
              chip.id === 'latest'
                ? { latest: true }
                : {
                    dateA: addDays(
                      toDateString(new Date(now())),
                      -chip.daysBack,
                    ),
                  },
          })),
          {
            id: 'compare',
            label: t('Compare −7 days'),
            title: t('Drape the image from 7 days earlier alongside'),
            disabled: !snapshot || snapshot.tileStatus === 'none',
            onClick: () => {
              _showB = !_showB;
              if (_enabled) void refresh();
              notify();
            },
          },
          {
            id: 'open-worldview',
            label: t('Open in Worldview'),
            title: t('NASA Worldview, county-framed, active date'),
            disabled: !snapshot,
            onClick: () => {
              if (snapshot?.worldviewUrl) openUrl(snapshot.worldviewUrl);
            },
          },
          {
            id: 'open-copernicus-browser',
            label: t('Open in Copernicus Browser'),
            title: t('Copernicus Browser, county-framed, active date'),
            disabled: !snapshot,
            onClick: () => {
              if (snapshot?.copernicusBrowserUrl)
                openUrl(snapshot.copernicusBrowserUrl);
            },
          },
        ],
        info,
        infoTitle: t(
          'True-color satellite imagery over Cape May County (NASA GIBS, public domain). The drape shows the newest processed pass for the active date; MODIS lags ~3–6 h behind acquisition, so today may serve yesterday. Sentinel-2 products come from the Copernicus catalogue (anonymous metadata); downloads need a free Dataspace account. Never a neighbouring date presented as the requested date.',
        ),
        legend: null,
        list: {
          ariaLabel: t('Sentinel-2 products over the county'),
          items: products.map((product, index) => ({
            id: product.id,
            ordinal: index + 1,
            lead: product.name,
            text:
              `${product.sensingDate} · ${product.tile ?? ''} · ${product.level ?? ''}` +
              (product.countyTile ? ` · ${t('Cape May tile')}` : ''),
            disabled: false,
            params: { dateB: product.sensingDate },
          })),
        },
      };
    },

    setRowControlsListener(listener) {
      rowControlsListener = typeof listener === 'function' ? listener : null;
    },

    /**
     * Snapshot the Sentinel-2 products as plain JSON-safe objects for the
     * analyst query engine. On-demand only — zero per-frame cost, no
     * listeners, no caching. Returns [] while disabled or empty.
     * @param {number} [maxCount=2000] - Maximum records to return.
     * @returns {Array<Object>} See mapAnalystRecord for the record shape.
     */
    getAnalystRecords(maxCount = 2000) {
      if (!_enabled || !_snapshotA) return [];
      const limit = Number.isFinite(maxCount)
        ? Math.max(1, Math.floor(maxCount))
        : 2000;
      const result = [];
      for (const product of _snapshotA.products ?? []) {
        if (result.length >= limit) break;
        result.push(mapAnalystRecord(product, result.length));
      }
      return result;
    },

    getStats() {
      return {
        count: _snapshotA?.products?.length ?? 0,
        date: _snapshotA?.date ?? null,
        requestedDate: _snapshotA?.requestedDate ?? null,
        source: _snapshotA?.source ?? null,
        tileStatus: _snapshotA?.tileStatus ?? 'none',
        showB: _showB,
        drape: drape.getState(),
        lastUpdate: _lastUpdate,
        error: _lastError,
        stale: _stale,
      };
    },
  };
  return layer;
}
