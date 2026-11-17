// src/layers/hifldInstallations/records.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import snapshot from './mirtaSnapshot.json' with { type: 'json' };
import {
  normalizeHifldSite,
  numValue,
  searchHifldSites,
  sitesInStates,
  sortHifldSitesForOverlay,
  statusValue,
  validateSnapshot,
} from './records.js';

const NJ_NAMES = [
  'Atlantic City IAP',
  'Fort Monmouth Main Post',
  'Joint Base McGuire-Dix-Lakehurst',
  'NG Lawrenceville',
  'NG Sea Girt  NJ NGTC',
  'Naval Weapons Station Earle NJ',
  'Picatinny Arsenal',
  'Waterfront',
];

const DE_NAMES = [
  'Dover AFB',
  'New Castle Airport',
  'NG Bethany Beach Training Site',
  'NG River Road Training Site',
];

test('numValue never coerces null, empty, or boolean to 0', () => {
  assert.equal(numValue(null), null);
  assert.equal(numValue(''), null);
  assert.equal(numValue(true), null);
  assert.equal(numValue('40.2479'), 40.2479);
  assert.equal(numValue('abc'), null);
});

test('statusValue lowercases and maps empty to unknown', () => {
  assert.equal(statusValue('act'), 'act');
  assert.equal(statusValue('EXCS'), 'excs');
  assert.equal(statusValue('excs'), 'excs');
  assert.equal(statusValue(''), 'unknown');
  assert.equal(statusValue(null), 'unknown');
  assert.equal(statusValue('  clsd  '), 'clsd');
});

test('a site needs an id, name, state, status, and position', () => {
  assert.equal(normalizeHifldSite(null), null);
  assert.equal(
    normalizeHifldSite({
      id: 'x',
      name: 'No Position',
      state: 'nj',
      status: 'act',
      joint: false,
    }),
    null,
  );
  assert.equal(
    normalizeHifldSite({
      id: 'x',
      name: 'No Joint Flag',
      state: 'nj',
      status: 'act',
      lat: 40,
      lon: -74,
    }),
    null,
  );
  const row = normalizeHifldSite({
    id: '34855-fort-monmouth-main-post',
    name: 'Fort Monmouth Main Post',
    state: 'NJ',
    status: 'CLSD',
    component: 'usa',
    joint: false,
    installationId: '34855',
    lat: 40.3135,
    lon: -74.044,
  });
  assert.equal(row.state, 'nj');
  assert.equal(row.status, 'clsd');
  assert.equal(row.joint, false);
});

test('the bundled snapshot validates whole: 744 sites, frozen', () => {
  const validated = validateSnapshot(snapshot);
  assert.ok(validated);
  assert.equal(validated.featureCount, 744);
  assert.equal(validated.sites.length, 744);
  assert.equal(validated.sourceDates, '2023-08-25');
  assert.equal(validated.freezeDate, '2025-08-26');
  assert.equal(
    validated.freezeNote,
    'HIFLD snapshot — source data August 25, 2023; HIFLD Open shut down August 26, 2025; not live.',
  );
  assert.equal(validated.license, 'other (U.S. federal public domain origin)');
  assert.deepEqual(validated.counts, {
    sites: 744,
    nj: 8,
    de: 4,
    active: 712,
    closed: 13,
  });
  // A short snapshot fails closed, never partially publishes.
  assert.equal(
    validateSnapshot({ ...snapshot, sites: snapshot.sites.slice(0, 743) }),
    null,
  );
  assert.equal(validateSnapshot({ ...snapshot, featureCount: 743 }), null);
  assert.equal(validateSnapshot({ ...snapshot, sites: 'nope' }), null);
});

test('New Jersey rows are exactly the 8 recorded sites', () => {
  const validated = validateSnapshot(snapshot);
  const nj = sitesInStates(validated.sites, ['nj']);
  assert.equal(nj.length, 8);
  assert.deepEqual(
    nj.map((site) => site.name).sort(),
    [...NJ_NAMES].sort(),
  );
  const byName = Object.fromEntries(nj.map((site) => [site.name, site]));
  assert.equal(byName['Naval Weapons Station Earle NJ'].component, 'usn');
  assert.equal(byName['Naval Weapons Station Earle NJ'].status, 'act');
  assert.equal(
    byName['Joint Base McGuire-Dix-Lakehurst'].component,
    'usaf',
  );
  assert.equal(byName['Joint Base McGuire-Dix-Lakehurst'].joint, true);
  assert.equal(byName['Picatinny Arsenal'].component, 'usa');
  assert.equal(byName['Atlantic City IAP'].component, 'airNationalGuard');
  assert.equal(byName['NG Sea Girt  NJ NGTC'].component, 'armyNationalGuard');
});

test('Delaware rows are exactly the 4 recorded sites', () => {
  const validated = validateSnapshot(snapshot);
  const de = sitesInStates(validated.sites, ['de']);
  assert.equal(de.length, 4);
  assert.deepEqual(
    de.map((site) => site.name).sort(),
    [...DE_NAMES].sort(),
  );
  assert.ok(de.every((site) => site.status === 'act'));
});

test('search finds Picatinny and nothing for CAPE MAY', () => {
  const validated = validateSnapshot(snapshot);
  const picatinny = searchHifldSites(validated.sites, 'picatinny');
  assert.equal(picatinny.length, 1);
  assert.equal(picatinny[0].name, 'Picatinny Arsenal');
  // Coast Guard Training Center Cape May is NOT in MIRTA (DoD-only).
  assert.deepEqual(searchHifldSites(validated.sites, 'CAPE MAY'), []);
  assert.deepEqual(searchHifldSites(validated.sites, ''), []);
  assert.deepEqual(searchHifldSites(validated.sites, '  '), []);
});

test('Fort Monmouth is closed and its id pairs installationId with the slug', () => {
  const validated = validateSnapshot(snapshot);
  const monmouth = validated.sites.find(
    (site) => site.name === 'Fort Monmouth Main Post',
  );
  assert.ok(monmouth);
  assert.equal(monmouth.status, 'clsd');
  assert.equal(monmouth.installationId, '34855');
  assert.equal(monmouth.id, '34855-fort-monmouth-main-post');
  // Picatinny shares installationId 34855 but keeps its own id.
  const picatinny = validated.sites.find(
    (site) => site.name === 'Picatinny Arsenal',
  );
  assert.equal(picatinny.installationId, '34855');
  assert.equal(picatinny.id, '34855-picatinny-arsenal');
  // Overlay order puts the home states first.
  const ordered = sortHifldSitesForOverlay(validated.sites);
  assert.equal(ordered.slice(0, 12).filter((s) => s.state === 'nj').length, 8);
  assert.equal(ordered.slice(0, 12).filter((s) => s.state === 'de').length, 4);
});
