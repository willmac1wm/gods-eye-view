import * as Cesium from 'cesium';
import { formatNumber, msg, t } from '../../i18n/index.js';
import { translateFeedError } from '../../ui/statusText.js';
import {
  VDL2_OVERLAY_SOURCE_ID,
  VDL2_OVERLAY_COHORT_LIMIT,
  VDL2_OVERLAY_COLLISION_CAPACITY,
  vdl2SeverityColor,
  vdl2CategoryLabel,
  createVdl2OverlayEntry,
  selectVdl2OverlayCohort,
  mapAnalystRecord,
} from './model.js';
import { VDL2_KNOWN_CATEGORIES } from './records.js';
export * from './model.js';
export * from './records.js';
export { createVdl2Source } from './source.js';

/**
 * VDL2 datalink messages — categorized ACARS-style messages heard by
 * the PhillyRox-VDLM feeder at Philadelphia (KPHL) in the last hour,
 * through the same-origin /api/vdl2 proxy (airframes.io). Polled every
 * 5 min, only while the layer is enabled — the same cycle as the Cape
 * Dispatch ACARS watcher this layer ports.
 *
 * LIST-FIRST (v1): VDL2 messages are discrete datalink messages, not
 * aircraft — they usually carry no message-level position (null
 * lat/lon/altitude; a position comes only from the nested flight fix,
 * and only when it falls over local airspace). The panel lists every
 * categorized message and every local undecoded frame (`count`); only
 * the rows with a local flight fix get a pin (`pinned`). Routine
 * decodable traffic is counted in `heardLocal`, not listed.
 *
 * GUARDRAIL: only the category is shown — the raw message text is
 * never republished (ACARS free text can hold medical details,
 * passenger specifics, and crew names). Each row links out to the
 * original message on airframes.io for a human to read.
 *
 * Scope (William, 2026-11-15, via the watcher): the seven critical
 * categories — mayday, pan-pan, emergency, engine failure, smoke/fire
 * on board, depressurisation — alert anywhere in the US; diversion,
 * medical, minimum fuel, bird strike, and ground stop stay local-only
 * (a ground stop goes nationwide only when the text says so).
 *
 * Honest limitation: messages with no label, text, or data are
 * counted as "undecoded frames" — almost certainly CPDLC/ADS-C AVLC
 * payloads the public API does not decode — and are NOT presented as
 * a CPDLC feed. The PhillyRox feeder is flagged by airframes.io for
 * a rate anomaly (verified live 2026-11-16), so coverage may be
 * interrupted; the flag is surfaced in the panel.
 *
 * Credit: "VDL2 datalink messages: airframes.io" with a link —
 * see DATA_SOURCES.md.
 */
export function createVdl2Layer({ source, overlayHost } = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('VDL2 requires a snapshot source');
  if (!overlayHost) throw new TypeError('VDL2 requires an overlay host');
  let _viewer = null;
  let _request = null;
  let _dataSource = null;
  let _rows = [];
  let _heardLocal = null;
  let _heardTruncated = false;
  let _stationFlagged = false;
  let _stationFlagReason = null;
  let _lastUpdate = null;
  let _lastError = null;
  let _stale = false;
  let _enabled = false;

  const layer = {
    id: 'vdl2',
    name: 'VDL2 Messages',
    icon: '💬',
    source: 'airframes.io',
    updateInterval: 300000,

    init(viewer) {
      if (_viewer) throw new Error('VDL2 layer is already initialized');
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource('vdl2');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _rows = [];
      _heardLocal = null;
      _heardTruncated = false;
      _stationFlagged = false;
      _stationFlagReason = null;
      _lastUpdate = null;
      _lastError = null;
      _stale = false;
      _enabled = false;
      overlayHost.setVisible(VDL2_OVERLAY_SOURCE_ID, false);
      console.log('[Data:VDL2] Initialized');
    },

    enable(viewer) {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      overlayHost.setVisible(VDL2_OVERLAY_SOURCE_ID, true);
    },

    disable(viewer) {
      _request?.abort();
      _request = null;
      _enabled = false;
      if (_dataSource) _dataSource.show = false;
      overlayHost.clearSource(VDL2_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(VDL2_OVERLAY_SOURCE_ID, false);
    },

    async update(viewer) {
      if (!_enabled || !_dataSource) return false;
      _request?.abort();
      const request = new AbortController();
      _request = request;
      try {
        const snapshot = await source.getSnapshot({ signal: request.signal });
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;

        const rows = Array.isArray(snapshot?.rows) ? snapshot.rows : [];
        const nextEntities = [];
        let pinnedCount = 0;
        const overlayEntries = [];

        for (const row of rows) {
          if (!row?.hasPosition) continue; // list-only: panel, no pin
          pinnedCount++;
          const color = vdl2SeverityColor(row.severity);
          const position = Cesium.Cartesian3.fromDegrees(row.lon, row.lat);
          nextEntities.push(
            new Cesium.Entity({
              id: `vdl2:${row.id}`,
              position,
              ellipse: {
                semiMajorAxis: 1500,
                semiMinorAxis: 1500,
                material: new Cesium.ColorMaterialProperty(
                  color.withAlpha(0.35),
                ),
                outline: true,
                outlineColor: color.withAlpha(0.8),
                outlineWidth: 2,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
              },
              properties: {
                stableId: row.stableId,
                flight: row.flight,
                tail: row.tail,
                fromHex: row.fromHex,
                label: row.label,
                mode: row.mode,
                frequency: row.frequency,
                stationIdent: row.stationIdent,
                stationAirport: row.stationAirport,
                category: row.category,
                severity: row.severity,
                undecoded: row.undecoded,
                hasPosition: true,
                timeMs: row.timeMs,
                url: row.url,
              },
            }),
          );
          overlayEntries.push(
            createVdl2OverlayEntry({
              id: String(row.stableId),
              position,
              row,
            }),
          );
        }

        _dataSource.entities.removeAll();
        for (const entity of nextEntities) _dataSource.entities.add(entity);
        if (_enabled) {
          overlayHost.setEntries(
            VDL2_OVERLAY_SOURCE_ID,
            selectVdl2OverlayCohort(overlayEntries),
            {
              cohortLimit: VDL2_OVERLAY_COHORT_LIMIT,
              collisionCapacity: VDL2_OVERLAY_COLLISION_CAPACITY,
              moving: false,
            },
          );
        }

        _rows = rows;
        _heardLocal = Number.isFinite(snapshot?.heardLocal)
          ? snapshot.heardLocal
          : null;
        _heardTruncated = snapshot?.heardTruncated === true;
        _stationFlagged = snapshot?.stationFlagged === true;
        _stationFlagReason =
          typeof snapshot?.stationFlagReason === 'string'
            ? snapshot.stationFlagReason
            : null;
        _stale = snapshot?.stale === true;
        _lastUpdate = Date.now();
        _lastError = null;
        console.log(
          `[Data:VDL2] Updated: ${_rows.length} rows (${_rows.filter((row) => row?.category !== 'undecoded').length} categorized, ${_rows.filter((row) => row?.undecoded).length} undecoded) of ${_heardLocal ?? '?'} heard locally`,
        );
        return true;
      } catch (e) {
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        console.warn('[Data:VDL2] Fetch error:', e);
        _lastError = e?.message || msg('VDL2 source unavailable');
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
      overlayHost.clearSource(VDL2_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(VDL2_OVERLAY_SOURCE_ID, false);
      if (_dataSource) {
        viewer.dataSources.remove(_dataSource, true);
        _dataSource = null;
      }
      _rows = [];
      _heardLocal = null;
      _heardTruncated = false;
      _stationFlagged = false;
      _stationFlagReason = null;
      _lastUpdate = null;
      _lastError = null;
      _stale = false;
    },

    /**
     * Snapshot the layer's rows as plain JSON-safe objects for the
     * analyst query engine. On-demand only — zero per-frame cost, no
     * listeners, no caching. Returns [] while the layer is disabled or
     * empty. One record per row — categorized messages and local
     * undecoded frames alike (see model.js mapAnalystRecord).
     * @param {number} [maxCount=2000] - Maximum records to return.
     * @returns {Array<Object>} See mapAnalystRecord for the record shape.
     */
    getAnalystRecords(maxCount = 2000) {
      if (!_dataSource || !_dataSource.show) return [];
      const limit = Number.isFinite(maxCount)
        ? Math.max(1, Math.floor(maxCount))
        : 2000;
      return _rows
        .slice(0, limit)
        .map((row, index) => mapAnalystRecord(row, index));
    },

    getRowControls() {
      let info =
        _lastUpdate == null
          ? t('VDL2 datalink messages · not loaded yet')
          : t(
              'Last hour · {count} messages ({categorized} categorized, {undecoded} undecoded)',
              {
                count: formatNumber(_rows.length),
                categorized: formatNumber(
                  _rows.filter((row) => row?.category !== 'undecoded').length,
                ),
                undecoded: formatNumber(
                  _rows.filter((row) => row?.undecoded).length,
                ),
              },
            );
      if (_heardLocal != null && _lastUpdate != null)
        info += ` · ${t('heard locally: {heard}', { heard: formatNumber(_heardLocal) })}${_heardTruncated ? '+' : ''}`;
      if (_stationFlagged)
        info += ` · ${t('feeder flagged by airframes.io — rate anomaly')}`;
      if (_lastError) {
        const translated = translateFeedError(_lastError);
        if (translated) info += ` · ${translated}`;
      }
      const legend = VDL2_KNOWN_CATEGORIES.filter((category) =>
        _rows.some((row) => row?.category === category),
      ).map((category, index) => {
        const count = _rows.filter((row) => row?.category === category).length;
        const severity =
          category === 'undecoded'
            ? 'info'
            : (_rows.find((row) => row?.category === category)?.severity ??
              'info');
        return {
          label: vdl2CategoryLabel(category),
          color: vdl2SeverityColor(severity).toCssColorString(),
          count,
          ...(index === 0
            ? {
                blurb: t(
                  'Categories come from the message text; the raw text is never shown. Nationwide emergencies (mayday, pan-pan, emergency, engine failure, smoke/fire, depressurisation) alert anywhere in the US; diversions, medical, minimum fuel, bird strikes, and ground stops are local-only.',
                ),
              }
            : {}),
        };
      });
      return {
        chips: [],
        info,
        infoTitle: t(
          'Categorized VDL2 datalink messages heard by the PhillyRox feeder at Philadelphia (KPHL) in the last hour. Only the category is shown — the raw message text is never republished. Undecoded frames are messages with no label, text, or data, almost certainly CPDLC/ADS-C payloads this feed does not decode; they are counted, not presented as a CPDLC feed. Pins sit on the flight fix, only when it falls over local airspace — a stale fix is not pinned.',
        ),
        legend,
      };
    },

    getStats() {
      return {
        count: _rows.length,
        categorized: _rows.filter((row) => row?.category !== 'undecoded')
          .length,
        undecoded: _rows.filter((row) => row?.undecoded).length,
        pinned: _rows.filter((row) => row?.hasPosition).length,
        listOnly: _rows.filter((row) => !row?.hasPosition).length,
        heardLocal: _heardLocal,
        heardTruncated: _heardTruncated,
        stationFlagged: _stationFlagged,
        stationFlagReason: _stationFlagReason,
        lastUpdate: _lastUpdate,
        error: _lastError,
        stale: _stale,
        // Load-bearing: explicit boolean so layerFeedState never reads
        // this feed as a flights fallback (src/data/feedState.js).
        fallback: false,
      };
    },
  };
  return layer;
}
