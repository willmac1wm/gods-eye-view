// scripts/generate-hifld-snapshot.mjs
// Manual-only snapshot builder for the HIFLD installations layer.
// HIFLD Open shut down August 26, 2025; the MIRTA DoD Sites – Points
// source data is dated August 25, 2023. The layer ships the generated
// snapshot bundled in the repo — it is NEVER fetched at runtime.
//
// Usage:
//   node scripts/generate-hifld-snapshot.mjs [geojson-path-or-url] [output-path]
// Defaults: the HIFLD Next STAC GeoJSON URL, then
// src/layers/hifldInstallations/mirtaSnapshot.json.
//
// The build enforces exactly 744 features and throws on any row that
// fails validation — a dropped row is a build failure, never a silent
// omission. Re-run and diff the output before re-publishing; the
// snapshot refreshes only when a maintainer re-verifies it by hand.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const HIFLD_SNAPSHOT_FEATURE_COUNT = 744;
export const HIFLD_GEOJSON_URL =
  'https://hifld.publicenvirodata.org/storage/hifld/mirta-dod-sites-points/mirta-dod-sites-points/v1.0.0/geojson/mirta-dod-sites-points-geojson.geojson';

const SOURCE = 'HIFLD Next / MIRTA DoD Sites – Points';
const PRODUCER = 'DoD DISDI';
const HOST = 'HIFLD Next (Data Rescue Project snapshot)';
const SOURCE_DATES = '2023-08-25';
const FREEZE_DATE = '2025-08-26';
const FREEZE_NOTE =
  'HIFLD snapshot — source data August 25, 2023; HIFLD Open shut down August 26, 2025; not live.';
const LICENSE = 'other (U.S. federal public domain origin)';

function slug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function statusValue(raw) {
  const text = String(raw ?? '').trim().toLowerCase();
  return text || 'unknown';
}

function jointValue(raw) {
  const text = String(raw ?? '').trim().toLowerCase();
  if (text === 'yes') return true;
  if (text === 'no') return false;
  throw new Error(`unrecognized isJointBase value: ${JSON.stringify(raw)}`);
}

function numValue(value) {
  if (value === null || value === '' || typeof value === 'boolean')
    return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Reduce one MIRTA feature to a snapshot row, or throw. Never drops. */
export function reduceMirtaFeature(feature, index) {
  const where = `feature ${index}`;
  const properties = feature?.properties;
  if (!properties || typeof properties !== 'object')
    throw new Error(`${where}: missing properties`);
  const geometry = feature?.geometry;
  if (geometry?.type !== 'Point' || !Array.isArray(geometry?.coordinates))
    throw new Error(`${where}: missing Point geometry`);
  const [lon, lat] = geometry.coordinates;
  if (!Number.isFinite(lat) || !Number.isFinite(lon))
    throw new Error(`${where}: non-numeric coordinates`);
  const name = String(properties.siteName ?? '').trim();
  if (!name) throw new Error(`${where}: missing siteName`);
  const state = String(properties.stateNameCode ?? '').trim().toLowerCase();
  if (!state) throw new Error(`${where}: missing stateNameCode`);
  const installationId =
    properties.installationId === null ||
    properties.installationId === undefined ||
    String(properties.installationId).trim() === ''
      ? null
      : String(properties.installationId).trim();
  const id = `${installationId ?? 'unknown'}-${slug(name)}`;
  return {
    id,
    name,
    state,
    status: statusValue(properties.siteOperationalStatus),
    component:
      String(properties.siteReportingComponent ?? '').trim() || null,
    joint: jointValue(properties.isJointBase),
    installationId,
    lat,
    lon,
  };
}

/** Build the snapshot envelope from a parsed MIRTA GeoJSON document. */
export function buildHifldSnapshot(geojson, generatedAt = new Date().toISOString().slice(0, 10)) {
  const features = geojson?.features;
  if (!Array.isArray(features))
    throw new Error('MIRTA document has no features array');
  if (features.length !== HIFLD_SNAPSHOT_FEATURE_COUNT)
    throw new Error(
      `expected ${HIFLD_SNAPSHOT_FEATURE_COUNT} MIRTA features, got ${features.length} — refusing to publish a partial snapshot`,
    );
  const sites = features.map((feature, index) =>
    reduceMirtaFeature(feature, index),
  );
  const seen = new Set();
  for (const site of sites) {
    if (seen.has(site.id))
      throw new Error(`duplicate snapshot id: ${site.id}`);
    seen.add(site.id);
  }
  return {
    source: SOURCE,
    producer: PRODUCER,
    host: HOST,
    sourceDates: SOURCE_DATES,
    freezeDate: FREEZE_DATE,
    freezeNote: FREEZE_NOTE,
    license: LICENSE,
    featureCount: HIFLD_SNAPSHOT_FEATURE_COUNT,
    generatedAt,
    sites,
  };
}

async function loadGeojson(input) {
  if (/^https?:\/\//.test(input)) {
    const response = await fetch(input, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok)
      throw new Error(`MIRTA GeoJSON HTTP ${response.status}`);
    return response.json();
  }
  return JSON.parse(readFileSync(input, 'utf8'));
}

const invoked = process.argv[1]
  ? path.resolve(process.argv[1]) === path.resolve(import.meta.filename)
  : false;
if (invoked) {
  const input = process.argv[2] ?? HIFLD_GEOJSON_URL;
  const output =
    process.argv[3] ?? 'src/layers/hifldInstallations/mirtaSnapshot.json';
  const geojson = await loadGeojson(input);
  const snapshot = buildHifldSnapshot(geojson);
  writeFileSync(output, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  const states = new Set(snapshot.sites.map((site) => site.state));
  console.log(
    `wrote ${output}: ${snapshot.sites.length} sites, ${states.size} states, ` +
      `NJ ${snapshot.sites.filter((s) => s.state === 'nj').length}, ` +
      `DE ${snapshot.sites.filter((s) => s.state === 'de').length}`,
  );
}
