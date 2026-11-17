// src/layers/sanctionsWatch/index.js
import * as Cesium from 'cesium';
import {
  SANCTIONS_OVERLAY_COHORT_LIMIT,
  createSanctionsOverlayEntries,
  mapAnalystRecord,
} from './model.js';
import {
  MAX_SCREENS_PER_UPDATE,
  SANCTIONS_OVERLAY_SOURCE_ID,
  SANCTIONS_REFRESH_MS,
  SCREEN_CACHE_TTL_MS,
  SEEN_RETENTION_MS,
  SANCTIONS_WATCH_LAYER_ID,
} from './policy.js';
import {
  coverageIsAlive,
  detectSignals,
  detectSilence,
  isSanctionsMatch,
  isValidImo,
  normalizeImo,
} from './records.js';
export * from './model.js';
export { createSanctionsSource } from './source.js';
export * from './records.js';

// A portable package (no i18n): the error stays English data and the layer
// panel shows it translated.
const msg = (text) => text;

/**
 * Own one sanctions / dark-vessel display and its refresh lifecycle.
 *
 * Signals are computed locally from the AIS feed on every refresh:
 * impossible reported speed, implied speed between fixes, identity
 * change per MMSI, and silence vs coverage for vessels that stop
 * reporting while others in the same box keep reporting. Only vessels
 * with a signal are screened, at most five per refresh, one IMO at a
 * time through the same-origin proxy (ArcNautical keyless: 100 req/hr
 * per IP — an on-demand lookup, not a bulk feed). A screening is never
 * repeated for the same IMO within an hour. Signals are observations,
 * never accusations; a GREEN screening means "no matches found in the
 * sources screened at <time>", never "this vessel is clean".
 */
export function createSanctionsWatchLayer({
  source,
  vessels = null,
  overlayHost,
  now = () => Date.now(),
} = {}) {
  if (typeof source?.screenVessel !== 'function')
    throw new TypeError('Sanctions watch requires a screening source');
  if (!overlayHost)
    throw new TypeError('Sanctions watch requires an overlay host');
  let _viewer = null;
  let _request = null;
  let _dataSource = null;
  let _flagged = [];
  let _lastUpdate = null;
  let _lastError = null;
  let _sourceUnavailable = false;
  let _enabled = false;
  /** mmsi -> {mmsi, imo, name, lat, lon, lastPositionEpoch, lastSeenMs} */
  const _seen = new Map();
  /** imo -> {screening, at} — one hour per IMO, per the ArcNautical docs. */
  const _screenings = new Map();

  function readVesselRecords() {
    try {
      const records = vessels?.getAnalystRecords?.();
      return Array.isArray(records) ? records : [];
    } catch {
      return [];
    }
  }

  const layer = {
    id: SANCTIONS_WATCH_LAYER_ID,
    name: 'Sanctions Watch',
    icon: '⚓',
    source: 'ArcNautical · AIS dark-vessel signals',
    updateInterval: SANCTIONS_REFRESH_MS,

    init(viewer) {
      if (_viewer)
        throw new Error('Sanctions watch layer is already initialized');
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource('sanctions-watch');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _flagged = [];
      _lastUpdate = null;
      _lastError = null;
      _sourceUnavailable = false;
      _enabled = false;
      _seen.clear();
      _screenings.clear();
      overlayHost.setVisible(SANCTIONS_OVERLAY_SOURCE_ID, false);
      console.log('[Data:SanctionsWatch] Initialized');
    },

    enable(viewer) {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      overlayHost.setVisible(SANCTIONS_OVERLAY_SOURCE_ID, true);
    },

    disable(viewer) {
      _request?.abort();
      _request = null;
      _enabled = false;
      if (_dataSource) _dataSource.show = false;
      overlayHost.clearSource(SANCTIONS_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(SANCTIONS_OVERLAY_SOURCE_ID, false);
    },

    async update(viewer) {
      if (!_enabled || !_dataSource) return false;
      _request?.abort();
      const request = new AbortController();
      _request = request;
      try {
        const nowMs = now();
        const records = readVesselRecords();
        const coverageAlive = coverageIsAlive(records, nowMs);
        const present = new Set();
        const candidates = [];
        for (const record of records) {
          const mmsi = String(record?.mmsi ?? '').trim();
          if (!mmsi) continue;
          present.add(mmsi);
          const previous = _seen.get(mmsi) ?? null;
          const seen = {
            mmsi,
            imo: normalizeImo(record?.imo),
            name: String(record?.name ?? '').trim() || null,
            lat: Number.isFinite(record?.lat) ? record.lat : null,
            lon: Number.isFinite(record?.lon) ? record.lon : null,
            lastPositionEpoch: Number.isFinite(record?.lastPositionEpoch)
              ? record.lastPositionEpoch
              : null,
            lastSeenMs: nowMs,
          };
          const signals = detectSignals(record, previous);
          _seen.set(mmsi, seen);
          if (signals.length > 0 && seen.lat !== null && seen.lon !== null) {
            candidates.push({ ...seen, signals });
          }
        }
        // Silence sweep: vessels seen before, absent now, quiet >6 h
        // while coverage is alive. Last known position is the pin.
        for (const [mmsi, seen] of _seen) {
          if (present.has(mmsi)) continue;
          if (nowMs - seen.lastSeenMs > SEEN_RETENTION_MS) {
            _seen.delete(mmsi);
            continue;
          }
          const silence = detectSilence(seen, nowMs, coverageAlive);
          if (silence && seen.lat !== null && seen.lon !== null) {
            candidates.push({ ...seen, signals: [silence] });
          }
        }
        // Screen only signaled vessels, at most five per refresh, and
        // never the same IMO twice within the hour.
        let screened = 0;
        for (const candidate of candidates) {
          if (screened >= MAX_SCREENS_PER_UPDATE) break;
          const imo = candidate.imo;
          if (!imo || !isValidImo(imo)) continue;
          const cached = _screenings.get(imo);
          if (cached && nowMs - cached.at < SCREEN_CACHE_TTL_MS) {
            candidate.screening = cached.screening;
            continue;
          }
          if (request.signal.aborted || _request !== request || !_enabled)
            return false;
          try {
            const screening = await source.screenVessel(imo, {
              signal: request.signal,
            });
            _screenings.set(imo, { screening, at: nowMs });
            candidate.screening = screening;
            screened += 1;
          } catch (err) {
            if (request.signal.aborted || _request !== request || !_enabled)
              return false;
            _sourceUnavailable = true;
            _lastError = err?.message || msg('Sanctions source unavailable');
          }
        }
        for (const candidate of candidates) {
          const imo = candidate.imo;
          if (!candidate.screening && imo) {
            const cached = _screenings.get(imo);
            if (cached) candidate.screening = cached.screening;
          }
        }
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        _flagged = candidates;
        if (_enabled) {
          overlayHost.setEntries(
            SANCTIONS_OVERLAY_SOURCE_ID,
            createSanctionsOverlayEntries({ flagged: _flagged }),
            {
              cohortLimit: SANCTIONS_OVERLAY_COHORT_LIMIT,
              moving: false,
            },
          );
        }
        _lastUpdate = nowMs;
        _lastError = _sourceUnavailable ? _lastError : null;
        console.log(
          `[Data:SanctionsWatch] Updated: ${_flagged.length} flagged vessel(s)`,
        );
        return true;
      } catch (e) {
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        console.warn('[Data:SanctionsWatch] Fetch error:', e);
        _lastError = e?.message || msg('Sanctions source unavailable');
        _sourceUnavailable = true;
        return false;
      } finally {
        if (_request === request) _request = null;
      }
    },

    destroy(viewer = _viewer) {
      _request?.abort();
      _request = null;
      _viewer = null;
      _enabled = false;
      overlayHost.clearSource(SANCTIONS_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(SANCTIONS_OVERLAY_SOURCE_ID, false);
      if (_dataSource) {
        viewer.dataSources.remove(_dataSource, true);
        _dataSource = null;
      }
      _flagged = [];
      _lastUpdate = null;
      _lastError = null;
      _sourceUnavailable = false;
      _seen.clear();
      _screenings.clear();
    },

    /**
     * Snapshot the flagged vessels as plain JSON-safe objects for the
     * analyst query engine. On-demand only — zero per-frame cost, no
     * listeners, no caching. Returns [] while disabled or empty.
     * @param {number} [maxCount=2000] - Maximum records to return.
     * @returns {Array<Object>} See mapAnalystRecord for the record shape.
     */
    getAnalystRecords(maxCount = 2000) {
      if (!_enabled || _flagged.length === 0) return [];
      const limit = Number.isFinite(maxCount)
        ? Math.max(1, Math.floor(maxCount))
        : 2000;
      const result = [];
      for (const row of _flagged) {
        if (result.length >= limit) break;
        result.push(mapAnalystRecord(row, result.length));
      }
      return result;
    },

    getStats() {
      return {
        count: _flagged.length,
        screened: _flagged.filter((row) => row.screening).length,
        matches: _flagged.filter((row) => isSanctionsMatch(row.screening))
          .length,
        signals: _flagged.reduce(
          (total, row) => total + (row.signals?.length ?? 0),
          0,
        ),
        lastUpdate: _lastUpdate,
        error: _lastError,
        sourceUnavailable: _sourceUnavailable,
      };
    },
  };
  return layer;
}
