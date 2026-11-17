import {
  COPERNICUS_COUNTY_POINT,
  COPERNICUS_COUNTY_TILE,
  GIBS_SOURCES,
  SATELLITE_COUNTY_BBOX,
  SATELLITE_COUNTY_CENTER,
  SATELLITE_COUNTY_TILE,
} from './policy.js';

export const GIBS_WMTS_BASE =
  'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';

const GIBS_BY_ID = new Map(GIBS_SOURCES.map((source) => [source.id, source]));

export function gibsSourceById(id) {
  return GIBS_BY_ID.get(id) ?? null;
}

/** Single county tile URL — the probe target for one source + date. */
export function gibsTileUrl({ sourceId, date, z, row, col }) {
  const source = gibsSourceById(sourceId);
  if (!source) throw new TypeError(`Unknown GIBS source: ${sourceId}`);
  if (!isValidDateString(date)) throw new TypeError(`Invalid date: ${date}`);
  return (
    `${GIBS_WMTS_BASE}/${source.gibsLayer}/default/${date}/` +
    `GoogleMapsCompatible_Level${source.maxLevel}/${z}/${row}/${col}.${source.format}`
  );
}

/** WMTS URL template for the drape ({z}/{y}/{x}, subdomains a/b/c). */
export function gibsTileUrlTemplate({ sourceId, date }) {
  const source = gibsSourceById(sourceId);
  if (!source) throw new TypeError(`Unknown GIBS source: ${sourceId}`);
  if (!isValidDateString(date)) throw new TypeError(`Invalid date: ${date}`);
  return (
    `https://gibs-{s}.earthdata.nasa.gov/wmts/epsg3857/best/${source.gibsLayer}/default/${date}/` +
    `GoogleMapsCompatible_Level${source.maxLevel}/{z}/{y}/{x}.${source.format}`
  );
}

/** The county tile (z9 195/149) for one source + date. */
export function countyTileUrl({ sourceId, date }) {
  return gibsTileUrl({
    sourceId,
    date,
    z: SATELLITE_COUNTY_TILE.z,
    row: SATELLITE_COUNTY_TILE.row,
    col: SATELLITE_COUNTY_TILE.col,
  });
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDateString(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

/** UTC `YYYY-MM-DD` for a Date (defaults to now). */
export function toDateString(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` shifted by n days (n may be negative). */
export function addDays(dateString, n) {
  if (!isValidDateString(dateString))
    throw new TypeError(`Invalid date: ${dateString}`);
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + n);
  return date.toISOString().slice(0, 10);
}

/**
 * Parse a Sentinel-2 product name:
 * S2A_MSIL1C_20230525T154941_N0510_R054_T18SVJ_20240908T142632.SAFE
 * → { sensingDate: '2023-05-25', tile: 'T18SVJ', level: 'L1C' }.
 * Returns nulls (never throws) when the name does not match.
 */
export function parseSentinelProductName(name) {
  const match =
    /^S2[ABC]_MSI(L1C|L2A)_(\d{4})(\d{2})(\d{2})T\d{6}_.*?_(T\d{2}[A-Z]{3})_/i.exec(
      String(name ?? ''),
    );
  if (!match) return { sensingDate: null, tile: null, level: null };
  return {
    sensingDate: `${match[2]}-${match[3]}-${match[4]}`,
    tile: match[5].toUpperCase(),
    level: match[1].toUpperCase(),
  };
}

/**
 * Normalize one OData product row to the layer's product shape.
 * ContentDate.Start is the sensing instant; the name is the fallback
 * (and the tile source — ContentDate carries no tile).
 */
export function normalizeODataProduct(row) {
  if (!row || typeof row !== 'object') return null;
  const name = typeof row.Name === 'string' ? row.Name : '';
  const parsed = parseSentinelProductName(name);
  const start = row.ContentDate?.Start;
  const sensingDate =
    (typeof start === 'string' && start.slice(0, 10)) || parsed.sensingDate;
  if (!name || !sensingDate) return null;
  return {
    id: typeof row.Id === 'string' ? row.Id : name,
    name,
    sensingDate,
    tile: parsed.tile,
    level: parsed.level,
    countyTile: parsed.tile === COPERNICUS_COUNTY_TILE,
  };
}

/** Normalize an OData Products payload (value[]) to product rows. */
export function normalizeODataProducts(payload) {
  const rows = payload && Array.isArray(payload.value) ? payload.value : [];
  return rows.map(normalizeODataProduct).filter(Boolean);
}

/** Worldview permalink, county-framed, for one date (documented ?v/&l/&t/). */
export function worldviewUrl(date) {
  const { latMin, latMax, lonMin, lonMax } = SATELLITE_COUNTY_BBOX;
  return (
    'https://worldview.earthdata.nasa.gov/?' +
    `v=${lonMin},${latMin},${lonMax},${latMax}` +
    '&l=MODIS_Terra_CorrectedReflectance_TrueColor' +
    `&t=${date}`
  );
}

/**
 * Copernicus Browser deep link, county-framed, for one date. The param
 * scheme (lat/lng/zoom/datasetId/date) is the EO Browser scheme the
 * current Browser inherits — its bundle reads all five names. If the
 * scheme ever changes, the link degrades to the Browser home view; it
 * never 404s. S2L2A is the Sentinel-2 L2A true-colour collection.
 */
export function copernicusBrowserUrl(date) {
  const { lat, lon } = COPERNICUS_COUNTY_POINT;
  return (
    'https://browser.dataspace.copernicus.eu/?' +
    `lat=${lat}&lng=${lon}&zoom=10&datasetId=S2L2A&date=${date}`
  );
}

/** The snapshot shape the source returns (and the layer renders). */
export function validateSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return ['snapshot'];
  const problems = [];
  if (!isValidDateString(snapshot.requestedDate))
    problems.push('requestedDate');
  if (!isValidDateString(snapshot.date)) problems.push('date');
  if (!['live', 'nearest', 'none'].includes(snapshot.tileStatus))
    problems.push('tileStatus');
  if (snapshot.tileStatus !== 'none' && !snapshot.source)
    problems.push('source');
  if (!Array.isArray(snapshot.products)) problems.push('products');
  return problems;
}

export { SATELLITE_COUNTY_CENTER, SATELLITE_COUNTY_TILE };
