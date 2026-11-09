import * as Cesium from 'cesium';
export { createScannerCallsSource } from './source.js';

// Portable package (no i18n): errors stay English data.
const msg = (text) => text;

export const SCANNER_OVERLAY_SOURCE_ID = 'scanner-calls';
const COHORT_LIMIT = 40;
const COLLISION_CAPACITY = 24;

const PRIORITY_COLOR = {
  high: '#ff4d4f',
  medium: '#ffb020',
  low: '#4cc9f0',
  routine: '#8aa4b8',
};

function timeLabel(ms) {
  const date = new Date(ms);
  return Number.isFinite(date.getTime())
    ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : '';
}

/** JSON-safe analyst record for one call. */
export function mapScannerAnalystRecord(call) {
  return {
    id: String(call?.id ?? ''),
    type: call?.type ?? null,
    priority: call?.priority ?? null,
    location: call?.location || null,
    municipality: call?.municipality || null,
    summary: call?.summary || null,
    units: Array.isArray(call?.units) ? call.units.join(', ') : null,
    lat: Number.isFinite(call?.lat) ? call.lat : null,
    lon: Number.isFinite(call?.lon) ? call.lon : null,
    timeMs: Number.isFinite(call?.createdMs) ? call.createdMs : null,
    audio: call?.audio ?? null,
  };
}

/** Transcribed radio-scanner calls (Fire Wire) as map points. */
export function createScannerCallsLayer({
  source,
  overlayHost,
  id = 'scanner-calls',
  name = 'Police, Fire & EMS Calls',
  icon = '🚨',
  sourceLabel = 'Fire Wire scanner',
} = {}) {
  const OVERLAY_ID = id;
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('Scanner calls require a snapshot source');
  if (!overlayHost) throw new TypeError('Scanner calls require an overlay host');
  let _viewer = null;
  let _dataSource = null;
  let _request = null;
  let _enabled = false;
  let _calls = [];
  let _lastUpdate = null;
  let _lastError = null;

  return {
    id,
    name,
    icon,
    source: sourceLabel,
    updateInterval: 30000,

    init(viewer) {
      if (_viewer) throw new Error(`${name} layer is already initialized`);
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource(id);
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      overlayHost.setVisible(OVERLAY_ID, false);
    },

    enable() {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      overlayHost.setVisible(OVERLAY_ID, true);
    },

    disable() {
      _request?.abort();
      _request = null;
      _enabled = false;
      if (_dataSource) _dataSource.show = false;
      overlayHost.clearSource(OVERLAY_ID);
      overlayHost.setVisible(OVERLAY_ID, false);
    },

    async update() {
      if (!_enabled || !_dataSource) return false;
      _request?.abort();
      const request = new AbortController();
      _request = request;
      try {
        const calls = await source.getSnapshot({ signal: request.signal });
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        const entities = [];
        const overlay = [];
        const now = Date.now();
        for (const call of calls) {
          const cssColor = PRIORITY_COLOR[call.priority] || PRIORITY_COLOR.medium;
          const color = Cesium.Color.fromCssColorString(cssColor);
          const ageMin = Math.max(0, (now - call.createdMs) / 60000);
          const fresh = ageMin < 60;
          const position = Cesium.Cartesian3.fromDegrees(call.lon, call.lat);
          entities.push(
            new Cesium.Entity({
              id: `${id}:${call.id}`,
              position,
              point: {
                pixelSize: fresh ? 14 : 9,
                color: color.withAlpha(fresh ? 0.95 : 0.6),
                outlineColor: Cesium.Color.BLACK.withAlpha(0.7),
                outlineWidth: 2,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
              },
              properties: mapScannerAnalystRecord(call),
            }),
          );
          const place = call.location || call.municipality;
          overlay.push({
            id: String(call.id),
            position,
            variant: 'label',
            title: `${call.type}${place ? ` · ${place}` : ''} · ${timeLabel(call.createdMs)}`,
            accent: cssColor,
            // Newest and most urgent first.
            priority:
              ({ high: 3, medium: 2, low: 1 }[call.priority] || 0) * 100000 -
              Math.round(ageMin),
            collisionGroup: 'ambient-label',
            paintLane: 'ambient-label',
            interactive: false,
            edgeFade: 'keyhole',
            horizonCull: true,
            terrainOcclusion: false,
            gapPx: 14,
            verticalOnly: true,
            placement: 'above',
          });
        }
        _dataSource.entities.removeAll();
        for (const entity of entities) _dataSource.entities.add(entity);
        overlayHost.setEntries(
          OVERLAY_ID,
          overlay.sort((a, b) => b.priority - a.priority).slice(0, COHORT_LIMIT),
          {
            cohortLimit: COHORT_LIMIT,
            collisionCapacity: COLLISION_CAPACITY,
            moving: false,
          },
        );
        _calls = calls;
        _lastUpdate = Date.now();
        _lastError = null;
        return true;
      } catch (e) {
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        _lastError = e?.message || msg('Scanner feed unavailable');
        return false;
      } finally {
        if (_request === request) _request = null;
      }
    },

    destroy(viewer = _viewer) {
      _request?.abort();
      _request = null;
      _enabled = false;
      overlayHost.clearSource(OVERLAY_ID);
      overlayHost.setVisible(OVERLAY_ID, false);
      if (_dataSource) {
        viewer?.dataSources?.remove(_dataSource, true);
        _dataSource = null;
      }
      _viewer = null;
      _calls = [];
      _lastUpdate = null;
      _lastError = null;
    },

    getAnalystRecords(maxCount = 500) {
      if (!_enabled) return [];
      return _calls.slice(0, Math.max(1, maxCount)).map(mapScannerAnalystRecord);
    },

    getStats() {
      return { count: _calls.length, lastUpdate: _lastUpdate, error: _lastError };
    },
  };
}
