// src/layers/hifldInstallations/source.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { HIFLD_SNAPSHOT, createHifldInstallationsSource } from './source.js';

test('the bundled snapshot validates: 744 sites, frozen', () => {
  const source = createHifldInstallationsSource();
  const snapshot = source.getSnapshot();
  assert.equal(snapshot.sites.length, 744);
  assert.equal(snapshot.featureCount, 744);
  assert.equal(snapshot.freezeDate, '2025-08-26');
  assert.equal(
    snapshot.freezeNote,
    'HIFLD snapshot — source data August 25, 2023; HIFLD Open shut down August 26, 2025; not live.',
  );
  assert.equal(snapshot.counts.nj, 8);
  assert.equal(snapshot.counts.de, 4);
  assert.equal(HIFLD_SNAPSHOT.sites.length, 744);
});

test('an injected snapshot with a dropped row throws, never partially publishes', () => {
  const short = {
    ...HIFLD_SNAPSHOT,
    sites: HIFLD_SNAPSHOT.sites.slice(0, 743),
  };
  const source = createHifldInstallationsSource({ snapshot: short });
  assert.throws(
    () => source.getSnapshot(),
    /Invalid HIFLD installations snapshot/,
  );
});

test('an injected snapshot with a bad envelope throws', () => {
  const bad = { ...HIFLD_SNAPSHOT, freezeDate: '' };
  const source = createHifldInstallationsSource({ snapshot: bad });
  assert.throws(
    () => source.getSnapshot(),
    /Invalid HIFLD installations snapshot/,
  );
  const noSites = { ...HIFLD_SNAPSHOT, sites: 'nope' };
  assert.throws(
    () => createHifldInstallationsSource({ snapshot: noSites }).getSnapshot(),
    /Invalid HIFLD installations snapshot/,
  );
});

test('an injected snapshot with one renamed site validates and shows it', () => {
  const renamed = {
    ...HIFLD_SNAPSHOT,
    sites: HIFLD_SNAPSHOT.sites.map((site, index) =>
      index === 0 ? { ...site, name: 'Renamed Site' } : site,
    ),
  };
  const source = createHifldInstallationsSource({ snapshot: renamed });
  assert.equal(source.getSnapshot().sites[0].name, 'Renamed Site');
  assert.equal(source.getSnapshot().sites.length, 744);
});

test('an aborted signal throws before reading', () => {
  const source = createHifldInstallationsSource();
  const controller = new AbortController();
  controller.abort();
  assert.throws(
    () => source.getSnapshot({ signal: controller.signal }),
    (error) => error.name === 'AbortError',
  );
});
