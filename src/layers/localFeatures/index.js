import * as Cesium from 'cesium';
import { fetchLocal } from '../../local/api.js';
import { clearDetails, detailsEntityId, registerDetails, DETAILS_ID_PREFIX } from '../../local/registry.js';
import { nearMyTown, subscribeMyTown } from '../../local/myTown.js';

const msg = (text) => text;

function ringCentroid(ring) {
  let lat = 0;
  let lon = 0;
  for (const [x, y] of ring) {
    lon += x;
    lat += y;
  }
  return { lat: lat / ring.length, lon: lon / ring.length };
}

/**
 * A map layer for one /api/local source: points, outlined areas and road
 * segments, with a label per item and a details record per item.
 *
 * @param {object} options
 * @param {string} options.id            layer id (data-layer catalog)
 * @param {string} options.name          English layer name
 * @param {string} options.icon
 * @param {string} options.sourceLabel   short source line for the panel
 * @param {string} options.endpoint      /api/local/<endpoint>
 * @param {object} options.overlayHost
 * @param {(feature, envelope) => object} options.toRecord  details record
 * @param {boolean} [options.filterable=true] apply the My Town map filter
 * @param {number} [options.updateInterval=120000]
 * @param {number} [options.labelLimit=40]
 * @param {number} [options.fillAlpha=0.12]
 * @param {(feature) => boolean} [options.include]
 */
export function createLocalFeatureLayer({
  id,
  name,
  icon,
  sourceLabel,
  endpoint,
  overlayHost,
  toRecord,
  filterable = true,
  updateInterval = 120000,
  labelLimit = 40,
  fillAlpha = 0.12,
  include = () => true,
  fetchImpl = fetchLocal,
}) {
  let viewer = null;
  let dataSource = null;
  let enabled = false;
  let request = null;
  let envelope = null;
  let shown = 0;
  let lastUpdate = null;
  let lastError = null;
  let unsubscribeTown = null;
  const prefix = `${DETAILS_ID_PREFIX}${id}:`;

  function draw() {
    if (!dataSource || !envelope) return;
    clearDetails(prefix);
    dataSource.entities.removeAll();
    const labels = [];
    shown = 0;
    for (const [index, f] of envelope.features.entries()) {
      if (!f.geometry || !include(f, index) || f.showOnMap === false) continue;
      const point = f.geometry.type === 'Point' ? f.geometry : f.geometry.rings ? ringCentroid(f.geometry.rings[0]) : null;
      if (filterable && point && !nearMyTown(point.lat, point.lon)) continue;
      const record = toRecord(f, envelope);
      if (envelope.status === 'delayed') {
        record.status = 'delayed';
        record.note = [envelope.note, record.note].filter(Boolean).join(' — ');
      }
      record.fetchedAt = envelope.fetchedAt;
      if (point && record.lat == null) {
        record.lat = point.lat;
        record.lon = point.lon;
      }
      const color = Cesium.Color.fromCssColorString(f.color || '#4cc9f0');
      const baseId = detailsEntityId(id, f.id);
      if (f.geometry.type === 'Point') {
        dataSource.entities.add(
          new Cesium.Entity({
            id: baseId,
            position: Cesium.Cartesian3.fromDegrees(f.geometry.lon, f.geometry.lat),
            point: {
              pixelSize: 11,
              color: color.withAlpha(0.95),
              outlineColor: Cesium.Color.BLACK.withAlpha(0.75),
              outlineWidth: 2,
              heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
          }),
        );
        registerDetails(baseId, record);
      } else if (f.geometry.rings) {
        for (const [ri, ring] of f.geometry.rings.entries()) {
          if (!Array.isArray(ring) || ring.length < 3) continue;
          const eid = `${baseId}#${ri}`;
          const flat = ring.flatMap(([x, y]) => [x, y]);
          dataSource.entities.add(
            new Cesium.Entity({
              id: eid,
              polygon: {
                hierarchy: Cesium.Cartesian3.fromDegreesArray(flat),
                material: color.withAlpha(fillAlpha),
                classificationType: Cesium.ClassificationType.BOTH,
              },
              polyline: {
                positions: Cesium.Cartesian3.fromDegreesArray(flat),
                width: 2,
                material: color.withAlpha(0.9),
                clampToGround: true,
                classificationType: Cesium.ClassificationType.BOTH,
              },
            }),
          );
          registerDetails(eid, record);
        }
      }
      if (Array.isArray(f.line) && f.line.length > 1) {
        const eid = `${baseId}#line`;
        dataSource.entities.add(
          new Cesium.Entity({
            id: eid,
            polyline: {
              positions: Cesium.Cartesian3.fromDegreesArray(f.line.flatMap(([x, y]) => [x, y])),
              width: 4,
              material: color.withAlpha(0.85),
              clampToGround: true,
              classificationType: Cesium.ClassificationType.BOTH,
            },
          }),
        );
        registerDetails(eid, record);
      }
      shown += 1;
      if (point && f.label) {
        labels.push({
          id: String(f.id),
          position: Cesium.Cartesian3.fromDegrees(point.lon, point.lat),
          variant: 'label',
          title: f.label,
          accent: f.color || '#4cc9f0',
          priority: (f.rank || 0) * 1000 + (envelope.features.length - index),
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
    }
    if (enabled) {
      overlayHost.setEntries(
        id,
        labels.sort((a, b) => b.priority - a.priority).slice(0, labelLimit),
        { cohortLimit: labelLimit, collisionCapacity: Math.min(32, labelLimit), moving: false },
      );
    }
    viewer?.scene?.requestRender?.();
  }

  return {
    id,
    name,
    icon,
    source: sourceLabel,
    updateInterval,

    init(v) {
      viewer = v;
      dataSource = new Cesium.CustomDataSource(id);
      dataSource.show = false;
      viewer.dataSources.add(dataSource);
      overlayHost.setVisible(id, false);
    },

    enable() {
      enabled = true;
      if (dataSource) dataSource.show = true;
      overlayHost.setVisible(id, true);
      unsubscribeTown ??= subscribeMyTown(() => draw());
      draw();
    },

    disable() {
      request?.abort();
      request = null;
      enabled = false;
      if (dataSource) dataSource.show = false;
      overlayHost.clearSource(id);
      overlayHost.setVisible(id, false);
      clearDetails(prefix);
      unsubscribeTown?.();
      unsubscribeTown = null;
    },

    async update() {
      if (!enabled) return false;
      request?.abort();
      const r = new AbortController();
      request = r;
      try {
        const env = await fetchImpl(endpoint, { signal: r.signal });
        if (r.signal.aborted || !enabled) return false;
        envelope = env;
        lastUpdate = Date.now();
        lastError =
          env.status === 'unavailable' && env.fetchedAt == null
            ? env.note || msg('Source unavailable')
            : env.status === 'delayed'
              ? `Delayed — ${env.note || 'last good data kept'}`
              : null;
        draw();
        return true;
      } catch (error) {
        if (r.signal.aborted) return false;
        lastError = error?.message || msg('Source unavailable');
        return false;
      } finally {
        if (request === r) request = null;
      }
    },

    destroy(v = viewer) {
      request?.abort();
      enabled = false;
      overlayHost.clearSource(id);
      overlayHost.setVisible(id, false);
      clearDetails(prefix);
      unsubscribeTown?.();
      if (dataSource) v?.dataSources?.remove(dataSource, true);
      dataSource = null;
      viewer = null;
    },

    /** Current envelope, for lists (County page, chat). */
    getEnvelope() {
      return envelope;
    },

    getAnalystRecords(max = 200) {
      if (!enabled || !envelope) return [];
      return envelope.features.slice(0, max).map((f) => ({
        id: f.id,
        title: f.title,
        status: envelope.status === 'delayed' ? 'delayed' : f.status,
        observedAt: f.observedAt || null,
        source: envelope.source?.name || null,
      }));
    },

    getStats() {
      const quiet =
        !lastError && envelope && shown === 0 && envelope.note
          ? { status: 'empty', statusMessage: envelope.note }
          : {};
      return { count: shown, lastUpdate, error: lastError, ...quiet };
    },
  };
}
