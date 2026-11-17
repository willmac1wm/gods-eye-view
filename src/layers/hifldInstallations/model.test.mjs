// src/layers/hifldInstallations/model.test.mjs
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import test from 'node:test';
import { HIFLD_SNAPSHOT } from './source.js';
import { validateSnapshot } from './records.js';
import {
  createHifldOverlayEntries,
  mapAnalystRecord,
  statusAccent,
} from './model.js';

const SNAPSHOT = validateSnapshot(HIFLD_SNAPSHOT);

test('overlay pins NJ/DE first and caps at 100', () => {
  const entries = createHifldOverlayEntries({ sites: SNAPSHOT.sites });
  assert.equal(entries.length, 100);
  const home = entries.slice(0, 12);
  assert.equal(home.filter((e) => e.subtitle.includes(' · NJ · ')).length, 8);
  assert.equal(home.filter((e) => e.subtitle.includes(' · DE · ')).length, 4);
  assert.ok(entries.every((entry) => entry.variant === 'label'));
  assert.ok(entries.every((entry) => entry.id.startsWith('hifld-installations-')));
  // Every entry id is unique.
  assert.equal(new Set(entries.map((e) => e.id)).size, 100);
});

test('Fort Monmouth is gray and closed; active sites are green', () => {
  assert.equal(statusAccent('act'), '#7cff9b');
  assert.equal(statusAccent('clsd'), '#9aa5ad');
  assert.equal(statusAccent('care'), '#ffc46b');
  const gray = Cesium.Color.fromCssColorString('#9aa5ad').toCssColorString();
  const green = Cesium.Color.fromCssColorString('#7cff9b').toCssColorString();
  const entries = createHifldOverlayEntries({ sites: SNAPSHOT.sites });
  const monmouth = entries.find((e) => e.title.includes('Fort Monmouth'));
  assert.ok(monmouth);
  assert.match(monmouth.subtitle, /Military installation · NJ · clsd/);
  assert.equal(monmouth.accent, gray);
  const earle = entries.find((e) => e.title.includes('Naval Weapons Station Earle'));
  assert.ok(earle);
  assert.match(earle.subtitle, /Military installation · NJ · act/);
  assert.equal(earle.accent, green);
});

test('mapAnalystRecord keeps the MIRTA fields', () => {
  const site = SNAPSHOT.sites.find(
    (s) => s.name === 'Joint Base McGuire-Dix-Lakehurst',
  );
  const record = mapAnalystRecord(site, 0);
  assert.deepEqual(record, {
    kind: 'installation',
    id: 'PTFL-joint-base-mcguire-dix-lakehurst',
    name: 'Joint Base McGuire-Dix-Lakehurst',
    state: 'nj',
    status: 'act',
    component: 'usaf',
    joint: true,
    installationId: 'PTFL',
    lat: site.lat,
    lon: site.lon,
  });
  assert.equal(mapAnalystRecord(null, 3).id, 'HIFLD-0003');
});
