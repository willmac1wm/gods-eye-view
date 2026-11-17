// Pure record rules for the ports snapshot: validation, normalization,
// and the pinned-coordinate checks the tests assert on. No network,
// no Cesium, no clock. A depth is carried only when the snapshot
// gives a number; null means "not verified from WPI" — never 0.
import { PORTS_WINDOW } from './policy.js';

export function numValue(value) {
  if (value === null || value === '' || typeof value === 'boolean') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function textValue(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function depthClassValue(value) {
  const text = textValue(value);
  if (text === 'shallow' || text === 'medium' || text === 'deep') return text;
  return null;
}

/** True when the fix falls inside the Mid-Atlantic snapshot window. */
export function inPortsWindow(record) {
  const lat = numValue(record?.lat);
  const lon = numValue(record?.lon);
  if (lat === null || lon === null) return false;
  return (
    lat >= PORTS_WINDOW.minLat &&
    lat <= PORTS_WINDOW.maxLat &&
    lon >= PORTS_WINDOW.minLon &&
    lon <= PORTS_WINDOW.maxLon
  );
}

/**
 * Normalize one port row, or null when it has no usable id, name, or
 * position. A port outside the window is dropped, not moved.
 */
export function normalizePort(record) {
  if (!record || typeof record !== 'object') return null;
  const id = textValue(record.id);
  const name = textValue(record.name);
  const lat = numValue(record.lat);
  const lon = numValue(record.lon);
  if (!id || !name || lat === null || lon === null) return null;
  if (!inPortsWindow(record)) return null;
  return {
    kind: 'port',
    id,
    name,
    locode: textValue(record.locode),
    state: textValue(record.state),
    lat,
    lon,
    channelDepthM: numValue(record.channelDepthM),
    anchorageDepthM: numValue(record.anchorageDepthM),
    tideRangeM: numValue(record.tideRangeM),
    depthClass: depthClassValue(record.depthClass),
    note: textValue(record.note),
    sources: Array.isArray(record.sources)
      ? record.sources.map((s) => textValue(s)).filter(Boolean)
      : [],
  };
}

/**
 * Normalize one chokepoint row, or null when it has no usable id,
 * name, or position. Chokepoints are worldwide, so no window check.
 */
export function normalizeChokepoint(record) {
  if (!record || typeof record !== 'object') return null;
  const id = textValue(record.id);
  const name = textValue(record.name);
  const lat = numValue(record.lat);
  const lon = numValue(record.lon);
  if (!id || !name || lat === null || lon === null) return null;
  return {
    kind: 'chokepoint',
    id,
    name,
    lat,
    lon,
    connects: textValue(record.connects),
    note: textValue(record.note),
  };
}

/**
 * Validate a snapshot object into normalized rows. Bad rows are
 * dropped and named in `errors` — a corrupt row never takes the
 * whole snapshot down, and a missing snapshot is an error, never
 * an authoritative empty map.
 */
export function validateSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') {
    return {
      version: null,
      generatedAt: null,
      ports: [],
      chokepoints: [],
      errors: ['snapshot missing'],
    };
  }
  const errors = [];
  const ports = [];
  const rawPorts = Array.isArray(snapshot.ports) ? snapshot.ports : [];
  if (!Array.isArray(snapshot.ports)) errors.push('snapshot.ports missing');
  for (const row of rawPorts) {
    const port = normalizePort(row);
    if (port) ports.push(port);
    else errors.push(`dropped port row: ${textValue(row?.id) ?? 'no id'}`);
  }
  const chokepoints = [];
  const rawChokepoints = Array.isArray(snapshot.chokepoints)
    ? snapshot.chokepoints
    : [];
  if (!Array.isArray(snapshot.chokepoints))
    errors.push('snapshot.chokepoints missing');
  for (const row of rawChokepoints) {
    const point = normalizeChokepoint(row);
    if (point) chokepoints.push(point);
    else
      errors.push(`dropped chokepoint row: ${textValue(row?.id) ?? 'no id'}`);
  }
  return {
    version: numValue(snapshot.version),
    generatedAt: textValue(snapshot.generatedAt),
    ports,
    chokepoints,
    errors,
  };
}
