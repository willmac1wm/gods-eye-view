/**
 * @module sigmet
 *
 * International SIGMET polygons from NOAA / Aviation Weather Center.
 * Browser fetches are same-origin (`/api/aviation/isigmet`) because
 * aviationweather.gov does not send Access-Control-Allow-Origin.
 * The Vite proxy is the only upstream hop; no API key is required.
 *
 * Rendered as extruded region polygons. Clicking one publishes a HUD
 * card with hazard + valid time. Not a TFR layer — WorldView's toggle
 * was mislabeled.
 */
import * as Cesium from 'cesium';
import {
  registerEntityContext,
  removeEntityContextsForLayer,
  selectEntityContext,
} from './contextStore.js';
import { governorRequestRender } from '../renderGovernor.js';

export const LAYER_ID = 'sigmet';
export const SIGMET_PROXY_PATH = '/api/aviation/isigmet';
export const SIGMET_UPSTREAM_URL = 'https://aviationweather.gov/api/data/isigmet?format=geojson';
export const DEFAULT_UPDATE_INTERVAL_MS = 180000;
export const DEFAULT_EXTRUDE_TOP_M = 15000;
export const FLIGHT_LEVEL_TO_METERS = 100 * 0.3048;

const HAZARD_COLORS = Object.freeze({
  TS: '#ff3b30',
  CONVECTIVE: '#ff3b30',
  TURB: '#ff9f0a',
  TURBULENCE: '#ff9f0a',
  ICE: '#64d2ff',
  ICING: '#64d2ff',
  VA: '#bf5af2',
  ASH: '#bf5af2',
  DS: '#c7a26b',
  SS: '#c7a26b',
  MTW: '#ffd60a',
  IFR: '#8e8e93',
});
const DEFAULT_HAZARD_COLOR = '#ff6600';

function text(value) {
  const raw = String(value ?? '').trim();
  return raw || null;
}

function finiteNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

/** Map AWC hazard tokens onto a CSS hex used for fill/outline/card accent. */
export function hazardColorCss(hazard) {
  const key = String(hazard || '').trim().toUpperCase();
  if (!key) return DEFAULT_HAZARD_COLOR;
  if (HAZARD_COLORS[key]) return HAZARD_COLORS[key];
  const compact = key.replace(/[^A-Z]/g, '');
  return HAZARD_COLORS[compact] || DEFAULT_HAZARD_COLOR;
}

/**
 * Format AWC unix-second (or ms) timestamps as a UTC valid window.
 * @param {number|string|null} fromRaw
 * @param {number|string|null} toRaw
 * @returns {string|null}
 */
export function formatSigmetValidRange(fromRaw, toRaw) {
  const formatOne = (raw) => {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return null;
    const ms = n > 1e12 ? n : n * 1000;
    const date = new Date(ms);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString().replace('.000Z', 'Z').replace('T', ' ');
  };
  const from = formatOne(fromRaw);
  const to = formatOne(toRaw);
  if (from && to) return `${from} – ${to}`;
  return from || to || null;
}

/**
 * Convert AWC `base`/`top` (hundreds of feet / flight level) to ellipsoid meters.
 * Missing/zero base stays on the surface; missing top uses the WorldView 15 km default.
 */
export function flightLevelToMeters(level, fallbackM) {
  const n = finiteNumber(level);
  if (n == null || n <= 0) return fallbackM;
  return Math.max(0, n * FLIGHT_LEVEL_TO_METERS);
}

function ringToDegrees(ring) {
  if (!Array.isArray(ring)) return [];
  return ring
    .map((coord) => {
      if (!Array.isArray(coord) || coord.length < 2) return null;
      const lon = Number(coord[0]);
      const lat = Number(coord[1]);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
      return [lon, lat];
    })
    .filter(Boolean);
}

/**
 * Normalize Polygon / MultiPolygon coordinates into polygon parts
 * `{ outer, holes }[]` with [lon, lat] rings.
 */
export function polygonPartsFromGeometry(geometry) {
  if (!geometry || typeof geometry !== 'object') return [];
  const type = String(geometry.type || '');
  const coords = geometry.coordinates;
  const asPolygon = (polygonCoords) => {
    if (!Array.isArray(polygonCoords) || !polygonCoords.length) return null;
    const rings = polygonCoords.map(ringToDegrees).filter((ring) => ring.length >= 4 || ring.length >= 3);
    if (!rings.length || rings[0].length < 3) return null;
    return { outer: rings[0], holes: rings.slice(1) };
  };
  if (type === 'Polygon') {
    const part = asPolygon(coords);
    return part ? [part] : [];
  }
  if (type === 'MultiPolygon' && Array.isArray(coords)) {
    return coords.map(asPolygon).filter(Boolean);
  }
  return [];
}

function ringCentroid(ring) {
  let lon = 0;
  let lat = 0;
  let n = 0;
  for (const coord of ring) {
    lon += coord[0];
    lat += coord[1];
    n += 1;
  }
  if (!n) return null;
  return { lon: lon / n, lat: lat / n };
}

/**
 * Flatten one GeoJSON feature into card/render records (one per polygon part).
 * @returns {Array<object>}
 */
export function mapSigmetFeature(feature, index = 0) {
  if (!feature || typeof feature !== 'object') return [];
  const props = feature.properties && typeof feature.properties === 'object' ? feature.properties : {};
  const parts = polygonPartsFromGeometry(feature.geometry);
  if (!parts.length) return [];
  const hazard = text(props.hazard) || 'WEATHER';
  const icaoId = text(props.icaoId) || text(props.firId) || text(props.airspace);
  const alpha = text(props.alphaChar);
  const validFrom = props.validTimeFrom ?? null;
  const validTo = props.validTimeTo ?? null;
  const validLabel = formatSigmetValidRange(validFrom, validTo);
  const raw = text(props.rawSigmet) || text(props.rawAirSigmet) || text(props.rawIsigmet);
  const baseId = text(feature.id)
    || [icaoId, alpha, hazard, validFrom].filter((part) => part != null && part !== '').join('-')
    || `sigmet-${index}`;
  const baseM = flightLevelToMeters(props.base, 0);
  const topM = Math.max(baseM + 500, flightLevelToMeters(props.top, DEFAULT_EXTRUDE_TOP_M));
  const accent = hazardColorCss(hazard);

  return parts.map((part, partIndex) => {
    const centroid = ringCentroid(part.outer);
    return {
      id: parts.length > 1 ? `${baseId}:${partIndex}` : String(baseId),
      hazard,
      icaoId,
      alphaChar: alpha,
      airspace: text(props.airspace) || icaoId,
      qualifier: text(props.qualifier),
      validFrom,
      validTo,
      validLabel,
      raw,
      baseM,
      topM,
      accent,
      outer: part.outer,
      holes: part.holes,
      latitude: centroid?.lat ?? null,
      longitude: centroid?.lon ?? null,
    };
  });
}

function hierarchyFromPart(part) {
  const outer = part.outer.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat));
  const holes = (part.holes || []).map((ring) => (
    new Cesium.PolygonHierarchy(ring.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat)))
  ));
  return new Cesium.PolygonHierarchy(outer, holes);
}

function cardDetails(record) {
  const details = [`HAZARD ${record.hazard}`];
  if (record.validLabel) details.push(`VALID ${record.validLabel}`);
  if (record.airspace) details.push(`AIRSPACE ${record.airspace}`);
  if (record.qualifier) details.push(`QUAL ${record.qualifier}`);
  return details;
}

export function createSigmetLayer() {
  let _dataSource = null;
  let _clickHandler = null;
  let _count = 0;
  let _lastUpdate = null;
  let _lastError = null;
  let _loading = false;
  let _enabled = false;

  function clearEntities() {
    removeEntityContextsForLayer(LAYER_ID);
    if (_dataSource) _dataSource.entities.removeAll();
  }

  function addRecord(record) {
    const color = Cesium.Color.fromCssColorString(record.accent);
    const position = Number.isFinite(record.longitude) && Number.isFinite(record.latitude)
      ? Cesium.Cartesian3.fromDegrees(record.longitude, record.latitude, record.topM)
      : null;
    const entity = _dataSource.entities.add({
      id: `sigmet:${record.id}`,
      position: position || undefined,
      polygon: {
        hierarchy: hierarchyFromPart(record),
        material: color.withAlpha(0.28),
        outline: true,
        outlineColor: color.withAlpha(0.95),
        outlineWidth: 2,
        height: record.baseM,
        extrudedHeight: record.topM,
      },
    });
    entity.gevTrackedId = `sigmet:${record.id}`;
    entity.gevDisplayPosition = () => position;
    entity.gevLabelModel = {
      title: record.icaoId ? `SIGMET ${record.hazard} ${record.icaoId}` : `SIGMET ${record.hazard}`,
      details: cardDetails(record),
      accent: record.accent,
    };
    registerEntityContext(entity, {
      id: record.id,
      layerId: LAYER_ID,
      layerName: 'SIGMET',
      source: 'NOAA Aviation Weather Center',
      label: entity.gevLabelModel.title,
      latitude: record.latitude,
      longitude: record.longitude,
      properties: {
        hazard: record.hazard,
        validFrom: record.validFrom,
        validTo: record.validTo,
        validLabel: record.validLabel,
        airspace: record.airspace,
        qualifier: record.qualifier,
      },
    });
  }

  function onClick(click) {
    if (!_enabled || !_dataSource) return;
    const viewer = _clickHandler?._gevViewer;
    if (!viewer) return;
    const picked = viewer.scene.pick(click.position);
    const entity = picked?.id;
    if (!entity || typeof entity !== 'object') return;
    if (entity.entityCollection !== _dataSource.entities) return;
    selectEntityContext(entity);
    governorRequestRender('sigmet-select');
  }

  const layer = {
    id: LAYER_ID,
    name: 'SIGMET',
    icon: '⚡',
    source: 'NOAA AWC',
    updateInterval: DEFAULT_UPDATE_INTERVAL_MS,

    init(viewer) {
      _dataSource = new Cesium.CustomDataSource(LAYER_ID);
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
      _loading = false;
      _enabled = false;
      if (!_clickHandler) {
        _clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
        _clickHandler._gevViewer = viewer;
        _clickHandler.setInputAction(onClick, Cesium.ScreenSpaceEventType.LEFT_CLICK);
      }
    },

    enable() {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
    },

    disable() {
      _enabled = false;
      if (_dataSource) _dataSource.show = false;
    },

    async update() {
      _loading = true;
      try {
        const response = await fetch(SIGMET_PROXY_PATH, {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) {
          _lastError = `AWC HTTP ${response.status}`;
          _loading = false;
          return false;
        }
        const geojson = await response.json();
        if (!geojson || !Array.isArray(geojson.features)) {
          _lastError = 'Malformed AWC SIGMET response';
          _loading = false;
          return false;
        }
        clearEntities();
        let count = 0;
        geojson.features.forEach((feature, index) => {
          const records = mapSigmetFeature(feature, index);
          records.forEach((record) => {
            addRecord(record);
            count += 1;
          });
        });
        _count = count;
        _lastUpdate = Date.now();
        _lastError = null;
        _loading = false;
        governorRequestRender('sigmet-update');
        return true;
      } catch (error) {
        _lastError = error?.name === 'TimeoutError' ? 'AWC timeout' : 'AWC network error';
        _loading = false;
        return false;
      }
    },

    destroy(viewer) {
      _enabled = false;
      clearEntities();
      if (_clickHandler) {
        _clickHandler.destroy();
        _clickHandler = null;
      }
      if (_dataSource) {
        viewer.dataSources.remove(_dataSource, true);
        _dataSource = null;
      }
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
      _loading = false;
    },

    getStats() {
      return {
        count: _count,
        lastUpdate: _lastUpdate,
        error: _lastError,
        loading: _loading,
        source: 'NOAA Aviation Weather Center',
      };
    },
  };

  return layer;
}

const sigmetLayer = createSigmetLayer();
export default sigmetLayer;
