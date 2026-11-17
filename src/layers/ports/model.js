// src/layers/ports/model.js
import * as Cesium from 'cesium';
import { msg } from '../../i18n/marker.js';
import { PORTS_ATTRIBUTION, PORTS_OVERLAY_SOURCE_ID } from './policy.js';

export const PORTS_OVERLAY_COHORT_LIMIT = 100;
export const PORTS_ATTRIBUTION_TEXT = PORTS_ATTRIBUTION;

function depthText(port) {
  if (port.channelDepthM !== null && port.channelDepthM !== undefined)
    return `channel ${port.channelDepthM} m`;
  if (port.depthClass) return `${port.depthClass} water`;
  return 'depth unverified';
}

/**
 * One label per port (blue) and one per chokepoint (amber). The copy
 * says what the snapshot knows: a numeric channel depth where WPI
 * gave one, otherwise the depth class — never an invented number.
 */
export function createPortsOverlayEntries({ ports = [], chokepoints = [] }) {
  const portEntries = ports
    .slice(0, PORTS_OVERLAY_COHORT_LIMIT)
    .map((port) => ({
      id: `${PORTS_OVERLAY_SOURCE_ID}-port-${port.id}`,
      position: Cesium.Cartesian3.fromDegrees(port.lon, port.lat),
      variant: 'label',
      title: `⚓ ${port.name}`,
      subtitle: `${msg('Port')}${port.state ? ` · ${port.state}` : ''} · ${depthText(port)}`,
      accent: Cesium.Color.fromCssColorString('#8fd3ff').toCssColorString(),
      priority: 1,
      collisionGroup: 'ambient-label',
      paintLane: 'ambient-label',
      interactive: false,
      edgeFade: 'keyhole',
      horizonCull: true,
      terrainOcclusion: false,
      gapPx: 15,
      verticalOnly: true,
      placement: 'above',
    }));
  const chokepointEntries = chokepoints
    .slice(0, PORTS_OVERLAY_COHORT_LIMIT)
    .map((point) => ({
      id: `${PORTS_OVERLAY_SOURCE_ID}-chokepoint-${point.id}`,
      position: Cesium.Cartesian3.fromDegrees(point.lon, point.lat),
      variant: 'label',
      title: `🌊 ${point.name}`,
      subtitle: `${msg('Chokepoint')}${point.connects ? ` · ${point.connects}` : ''}`,
      accent: Cesium.Color.fromCssColorString('#ffc46b').toCssColorString(),
      priority: 1,
      collisionGroup: 'ambient-label',
      paintLane: 'ambient-label',
      interactive: false,
      edgeFade: 'keyhole',
      horizonCull: true,
      terrainOcclusion: false,
      gapPx: 15,
      verticalOnly: true,
      placement: 'above',
    }));
  return [...portEntries, ...chokepointEntries];
}

/** Analyst seam. Pure — no Cesium types. */
export function mapAnalystRecord(raw, index = 0) {
  const num = (v) => (Number.isFinite(v) ? v : null);
  const text = (v) => {
    const t = String(v ?? '').trim();
    return t || null;
  };
  const kind = raw?.kind === 'chokepoint' ? 'chokepoint' : 'port';
  const base = {
    id: text(raw?.id) || `PORTS-${String(index).padStart(4, '0')}`,
    kind,
    name: text(raw?.name),
    lat: num(raw?.lat),
    lon: num(raw?.lon),
  };
  if (kind === 'chokepoint') {
    return { ...base, connects: text(raw?.connects) };
  }
  return {
    ...base,
    locode: text(raw?.locode),
    state: text(raw?.state),
    channelDepthM: num(raw?.channelDepthM),
    anchorageDepthM: num(raw?.anchorageDepthM),
    tideRangeM: num(raw?.tideRangeM),
    depthClass: text(raw?.depthClass),
  };
}
