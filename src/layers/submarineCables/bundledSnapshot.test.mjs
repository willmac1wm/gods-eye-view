// src/layers/submarineCables/bundledSnapshot.test.mjs
// Regression pins for the bundled TeleGeography snapshot (B6).
// The cables layer already exists upstream; this file pins what it
// ships so a corrupt or silently swapped snapshot fails loudly:
// exact feature counts, source.json hashes, the three New Jersey
// landings, and the catalog wiring (registry token, source contract,
// reference source, catalog membership). A deliberate refresh must
// update these pins by hand — see scripts/refresh-telegeography-snapshot.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApplicationCatalog } from '../../app/constructCatalog.js';
import { CATALOG_SOURCE_CONTRACTS } from '../../app/sourceComposition.js';
import { createSurfaceServices } from '../../app/surfaceServices.js';
import {
  LAYER_STATE_REGISTRY,
  LAYER_STATE_TOKEN_RESERVATIONS,
} from '../../data/layerState.js';
import { createReferenceSources } from '../../sources/reference.js';
import { createStandaloneLayerSources } from '../../standalone/layerSources.js';

const DATA_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../data/local_data/telegeography_submarine_cables',
);

function readJson(name) {
  return JSON.parse(readFileSync(path.join(DATA_DIR, name), 'utf8'));
}

function sha256(name) {
  return createHash('sha256')
    .update(readFileSync(path.join(DATA_DIR, name)))
    .digest('hex');
}

const EXPECTED = {
  cables: {
    file: 'cable-geo.json',
    name: 'submarine_cables',
    features: 712,
    sha256:
      '3d28db104e57982e7ae67fabe66f2ff8dc01e137458454e0de0032a8878c6bad',
  },
  landings: {
    file: 'landing-point-geo.json',
    name: 'landing_points',
    features: 1917,
    sha256:
      '11fc154189db51237099ffe1da2183984d666a906e5ed0e89b86421192eb622b',
  },
};

// [lon, lat] as shipped in the GeoJSON.
const NEW_JERSEY_LANDINGS = {
  'Tuckerton, NJ, United States': [-74.33791021235805, 39.60388495499803],
  'Wall Township, NJ, United States': [-74.06287361347052, 40.15287376160566],
  'Manasquan, NJ, United States': [-74.04704127778734, 40.12334092150613],
};

test('bundled cable snapshot pins 712 features and its recorded hash', () => {
  const doc = readJson(EXPECTED.cables.file);
  assert.equal(doc.type, 'FeatureCollection');
  assert.equal(doc.name, EXPECTED.cables.name);
  assert.equal(doc.features.length, EXPECTED.cables.features);
  assert.equal(sha256(EXPECTED.cables.file), EXPECTED.cables.sha256);
});

test('bundled landing-point snapshot pins 1,917 features and its recorded hash', () => {
  const doc = readJson(EXPECTED.landings.file);
  assert.equal(doc.type, 'FeatureCollection');
  assert.equal(doc.name, EXPECTED.landings.name);
  assert.equal(doc.features.length, EXPECTED.landings.features);
  assert.equal(sha256(EXPECTED.landings.file), EXPECTED.landings.sha256);
});

test('source.json agrees with the files on disk', () => {
  const manifest = readJson('source.json');
  assert.equal(manifest.id, 'telegeography-submarine-cables');
  assert.equal(manifest.downloaded_at, '2026-05-24');
  assert.match(
    manifest.license_note,
    /Check TeleGeography terms before redistribution/,
  );
  for (const { file, features, sha256: hash } of [
    EXPECTED.cables,
    EXPECTED.landings,
  ]) {
    const entry = manifest.files.find((row) => row.path === file);
    assert.ok(entry, `source.json must list ${file}`);
    assert.equal(entry.feature_count, features);
    assert.equal(entry.sha256, hash);
    assert.equal(entry.geojson_type, 'FeatureCollection');
  }
});

test('the three New Jersey landings keep their verified coordinates', () => {
  const doc = readJson(EXPECTED.landings.file);
  const byName = new Map(
    doc.features.map((feature) => [feature.properties?.name, feature]),
  );
  for (const [name, coordinates] of Object.entries(NEW_JERSEY_LANDINGS)) {
    const feature = byName.get(name);
    assert.ok(feature, `missing landing point ${name}`);
    assert.equal(feature.geometry?.type, 'Point');
    assert.deepEqual(feature.geometry.coordinates, coordinates);
  }
  const inNewJersey = doc.features.filter((feature) =>
    String(feature.properties?.name ?? '').includes(', NJ,'),
  );
  assert.equal(
    inNewJersey.length,
    3,
    'exactly three NJ landings ship in the snapshot',
  );
});

test('every bundled feature has a usable id and geometry', () => {
  const cables = readJson(EXPECTED.cables.file);
  // 712 features, 694 cable systems: 17 systems ship as two segments
  // sharing a properties.id, so per-feature uniqueness lives on
  // properties.feature_id (e.g. connected-coast-0 / connected-coast-1).
  const featureIds = new Set();
  const systemIds = new Set();
  for (const feature of cables.features) {
    const id = feature.properties?.id;
    const featureId = feature.properties?.feature_id;
    assert.equal(typeof id, 'string', 'cable needs a string system id');
    assert.equal(
      typeof featureId,
      'string',
      'cable needs a string feature id',
    );
    assert.ok(
      !featureIds.has(featureId),
      `duplicate cable feature id ${featureId}`,
    );
    featureIds.add(featureId);
    systemIds.add(id);
    assert.ok(
      feature.geometry?.type === 'LineString' ||
        feature.geometry?.type === 'MultiLineString',
      `cable ${id} needs a line geometry`,
    );
    const positions =
      feature.geometry.type === 'LineString'
        ? feature.geometry.coordinates
        : feature.geometry.coordinates.flat();
    assert.ok(positions.length >= 2, `cable ${id} needs 2+ positions`);
    for (const [lon, lat] of positions) {
      assert.ok(
        Number.isFinite(lon) && lon >= -180 && lon <= 180,
        `cable ${id} has an out-of-range longitude`,
      );
      assert.ok(
        Number.isFinite(lat) && lat >= -90 && lat <= 90,
        `cable ${id} has an out-of-range latitude`,
      );
    }
  }
  assert.equal(featureIds.size, 712);
  assert.equal(
    systemIds.size,
    694,
    '712 features cover 694 cable systems (17 split into two segments)',
  );
  const landings = readJson(EXPECTED.landings.file);
  const landingIds = new Set();
  for (const feature of landings.features) {
    const id = feature.properties?.id;
    assert.equal(typeof id, 'string', 'landing point needs a string id');
    assert.ok(!landingIds.has(id), `duplicate landing id ${id}`);
    landingIds.add(id);
    assert.equal(feature.geometry?.type, 'Point');
    const [lon, lat] = feature.geometry.coordinates;
    assert.ok(Number.isFinite(lon) && lon >= -180 && lon <= 180);
    assert.ok(Number.isFinite(lat) && lat >= -90 && lat <= 90);
  }
});

test('cables layer is registered with token u and wired through the catalog', () => {
  assert.equal(
    LAYER_STATE_TOKEN_RESERVATIONS['telegeography-submarine-cables'],
    'u',
  );
  const entry = LAYER_STATE_REGISTRY.find(
    ({ id }) => id === 'telegeography-submarine-cables',
  );
  assert.ok(entry, 'registry must list the cables layer');
  assert.equal(entry.token, 'u');
  assert.equal(entry.disposition, 'enabled-only');
  assert.deepEqual(CATALOG_SOURCE_CONTRACTS.cables.layers, [
    'telegeography-submarine-cables',
  ]);
  assert.ok(CATALOG_SOURCE_CONTRACTS.cables.methods.includes('fetch'));
  assert.equal(
    typeof createReferenceSources().cables.fetch,
    'function',
    'reference sources must serve the bundled cable source',
  );
});

test('the application catalog constructs the cables layer', () => {
  const lifetime = new AbortController();
  try {
    const catalog = createApplicationCatalog({
      sources: createStandaloneLayerSources(),
      signal: lifetime.signal,
      surface: createSurfaceServices({
        terrainSource: { getHeights: async () => [] },
        signal: lifetime.signal,
        eventTarget: null,
      }),
    });
    const layer = catalog.get('telegeography-submarine-cables');
    assert.ok(layer, 'catalog must include the cables layer');
    assert.equal(layer.id, 'telegeography-submarine-cables');
  } finally {
    lifetime.abort();
  }
});
