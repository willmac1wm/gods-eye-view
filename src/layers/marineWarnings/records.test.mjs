import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  stripBnmHtml,
  parseBnmTitle,
  findBnmReferences,
  parseBnmPositions,
  positionFromPoints,
  pickBnmPosition,
  parseCancelAt,
  severityForWarning,
  normalizeMarineWarningsSnapshot,
} from './records.js';
import { extractRssItems } from '../../../server/providers/marineWarnings.js';

// Live GovDelivery wording, captured 2026-11-16 (see fixtures/).
const NOW = Date.parse('2026-11-16T05:44:00Z');

function item(title, description, pubDate = 'Sun, 15 Nov 2026 20:43:18 -0600') {
  return {
    feed: 'sector-delaware-bay',
    guid: '1',
    title,
    link: null,
    pubDate,
    description,
  };
}

test('stripBnmHtml removes tags and decodes the entities the feed uses', () => {
  assert.equal(stripBnmHtml(''), '');
  assert.equal(stripBnmHtml(null), '');
  assert.equal(stripBnmHtml(42), '');
  assert.equal(
    stripBnmHtml(
      '<p>1. LISTON RANGE REAR LIGHT (LLNR 2450) RPTD EXT.<br />CANCEL AT//240100Z NOV 26//</p> <p>BT</p>',
    ),
    '1. LISTON RANGE REAR LIGHT (LLNR 2450) RPTD EXT. CANCEL AT//240100Z NOV 26// BT',
  );
  // The degree sign and curly quotes arrive as entities — they carry the
  // positions, so they must decode.
  assert.equal(
    stripBnmHtml('AT POSITION 39&deg;49.068&rsquo;N 75&deg;23.334&rsquo;W'),
    'AT POSITION 39°49.068’N 75°23.334’W',
  );
  assert.equal(stripBnmHtml('A &amp; B &#65;&#66;'), 'A & B AB');
  assert.equal(stripBnmHtml('UNKNOWN &bogus; STAYS'), 'UNKNOWN &bogus; STAYS');
});

test('parseBnmTitle reads every title shape in the live feeds', () => {
  assert.deepEqual(
    parseBnmTitle('SAFETY/DELAWARE RIVER/ATON/SEC SDB BNM 0288-26'),
    {
      criticality: 'SAFETY',
      area: 'DELAWARE RIVER',
      descriptor: 'ATON',
      originator: 'SEC SDB',
      number: '0288-26',
      stableId: 'SEC SDB:0288-26',
    },
  );
  assert.deepEqual(
    parseBnmTitle(
      'SAFETY/NEW YORK TO NORTH CAROLINA/RIGHT WHALE SLOW ZONE/CGD-E BNM 0523-26',
    ),
    {
      criticality: 'SAFETY',
      area: 'NEW YORK TO NORTH CAROLINA',
      descriptor: 'RIGHT WHALE SLOW ZONE',
      originator: 'CGD-E',
      number: '0523-26',
      stableId: 'CGD-E:0523-26',
    },
  );
  assert.deepEqual(parseBnmTitle('CANCELLATION/SEC SDB BNM 0283-26'), {
    criticality: 'CANCELLATION',
    area: null,
    descriptor: null,
    originator: 'SEC SDB',
    number: '0283-26',
    stableId: 'SEC SDB:0283-26',
  });
  // Multi-cancellation: no BNM number in the title — targets come from
  // the body, so the title alone parses to null.
  assert.equal(parseBnmTitle('CANCELLATION - MULTIPLE/SEC SDB'), null);
  // UPDATE criticality with a trailing UPDATE-1 suffix on the number.
  const update = parseBnmTitle(
    'UPDATE/MANASQUAN RIVER /ATON/SEC SDB BNM 0221-26 UPDATE-1',
  );
  assert.equal(update.criticality, 'UPDATE');
  assert.equal(update.area, 'MANASQUAN RIVER');
  assert.equal(update.descriptor, 'ATON');
  assert.equal(update.stableId, 'SEC SDB:0221-26');
  // Multi-segment area joins with ' / '.
  const multi = parseBnmTitle(
    'SAFETY/PA - NJ - DELAWARE RIVER - CHRISTINA RIVER/ATON/CGD-E BNM 0507-26',
  );
  assert.equal(multi.area, 'PA - NJ - DELAWARE RIVER - CHRISTINA RIVER');
  assert.equal(parseBnmTitle(''), null);
  assert.equal(parseBnmTitle(null), null);
  assert.equal(parseBnmTitle('NO BNM HERE'), null);
});

test('findBnmReferences lists every cancellation target in a body', () => {
  assert.deepEqual(
    findBnmReferences(
      '1. SEC SDB BNM 0240-26 DTG 021213Z OCT 26 A. AID NAME: INDIAN RIVER INLET BUOY 11 ' +
        '2. SEC SDB BNM 0241-26 DTG 021221Z OCT 26 A. AID NAME: INDIAN RIVER INLET BUOY 12',
    ),
    ['SEC SDB:0240-26', 'SEC SDB:0241-26'],
  );
  assert.deepEqual(
    findBnmReferences('1. CANCEL CGD-E BNM 0520-26 DTG 131754Z NOV 26 BT'),
    ['CGD-E:0520-26'],
  );
  assert.deepEqual(findBnmReferences('no references here'), []);
  assert.deepEqual(findBnmReferences(null), []);
});

test('parseBnmPositions handles every position format in the live feeds', () => {
  // Degrees-decimal-minutes (Brown Shoal Light, live SDB 0283-26).
  assert.deepEqual(
    parseBnmPositions(
      'HAS BEEN SET IN APPROX POSITION 38-55.35 N 075-06.01 W, SHOWING FL W 2.5S',
    ),
    [{ lat: 38.9225, lon: -75.10016666666667 }],
  );
  // Degree symbol with curly quote (Commodore Barry Bridge, live SDB 0277-26).
  const deg = parseBnmPositions(
    'AT POSITION 39°49.068’N 75°23.334’W AND 39°49.728’N 75°22.332’W',
  );
  assert.equal(deg.length, 2);
  assert.ok(Math.abs(deg[0].lat - 39.8178) < 1e-4);
  assert.ok(Math.abs(deg[0].lon - -75.3889) < 1e-4);
  // ASCII quote works too.
  assert.equal(parseBnmPositions("39°49.068'N 75°23.334'W").length, 1);
  // Degrees-minutes-seconds, both separators (live D5 0518-26, SDB 0221-26).
  const dms = parseBnmPositions(
    'RELOCATED TO APPROXIMATE POSITION 38-58-44-298N, 076-14-29.420W.',
  );
  assert.equal(dms.length, 1);
  assert.ok(Math.abs(dms[0].lat - (38 + 58 / 60 + 44.298 / 3600)) < 1e-6);
  assert.ok(Math.abs(dms[0].lon - -(76 + 14 / 60 + 29.42 / 3600)) < 1e-6);
  const dms2 = parseBnmPositions('IN POSN 40-05-25.117N 074-03-59.901W.');
  assert.ok(Math.abs(dms2[0].lat - (40 + 5 / 60 + 25.117 / 3600)) < 1e-6);
  // Spelled-out degrees (Right Whale Slow Zone, live D5 0523-26): two lats
  // then two lons pair in order.
  const words = parseBnmPositions(
    'BOUNDED BY: 40 DEGREES 21 MINUTES NORTH, 39 DEGREES 50 MINUTES NORTH, ' +
      '073 DEGREES 17 MINUTES WEST, 073 DEGREES 57 MINUTES WEST.',
  );
  assert.equal(words.length, 2);
  assert.ok(Math.abs(words[0].lat - (40 + 21 / 60)) < 1e-6);
  assert.ok(Math.abs(words[0].lon - -(73 + 17 / 60)) < 1e-6);
  assert.ok(Math.abs(words[1].lat - (39 + 50 / 60)) < 1e-6);
  // HAZOPS compact: trailing digit is tenths of a minute (live D5 0522-26).
  const compact = parseBnmPositions('21 NOV 0000-2400 17 34-17N5 076-45W2');
  assert.equal(compact.length, 1);
  assert.ok(Math.abs(compact[0].lat - (34 + 17.5 / 60)) < 1e-6);
  assert.ok(Math.abs(compact[0].lon - -(76 + 45.2 / 60)) < 1e-6);
  // Nothing parseable, invalid minutes, and garbage never throw.
  assert.deepEqual(
    parseBnmPositions('LISTON RANGE REAR LIGHT (LLNR 2450) RPTD EXT.'),
    [],
  );
  assert.deepEqual(parseBnmPositions(''), []);
  assert.deepEqual(parseBnmPositions(null), []);
  assert.deepEqual(parseBnmPositions('38-99.00 N 075-06.01 W'), []);
  assert.deepEqual(parseBnmPositions(undefined), []);
});

test('pickBnmPosition centroids polygons and takes the first point otherwise', () => {
  // Explicit BEGINNING AT … POINT OF BEGINNING (VCOA HAZOPS, live D5 0521-26).
  const poly = pickBnmPosition(
    'D. 0700-2000 LOCAL MON-FRI BEGINNING AT 37-30.00N 075-34.50W TO 37-30.00N 075-30.00W ' +
      'TO 37-00.00N 075-30.00W TO 37-00.00N 075-54.00W TO 37-03.00N 075-54.00W ' +
      'THEN 3 NM FROM AND PARALLEL TO THE SHORELINE THEN TO POINT OF BEGINNING.',
  );
  assert.equal(poly.polygon, true);
  assert.equal(poly.vertices, 5);
  assert.ok(Math.abs(poly.lat - 37.21) < 1e-3);
  assert.ok(Math.abs(poly.lon - -75.675) < 1e-3);
  // ≥3 positions without the polygon wording (ACOA compact vertex list)
  // centroid too.
  const acoa = pickBnmPosition(
    '14 OCT 0800-1200 14 39-10N3 074-12W4 38-48N3 073-55W0 38-58N4 074-20W3 39-01N3 074-25W8',
  );
  assert.equal(acoa.polygon, true);
  assert.equal(acoa.vertices, 4);
  assert.ok(Math.abs(acoa.lat - 38.9929) < 1e-4);
  assert.ok(Math.abs(acoa.lon - -74.2229) < 1e-4);
  // One or two positions: first point.
  const single = pickBnmPosition('POSITION 38-55.35 N 075-06.01 W');
  assert.equal(single.polygon, false);
  assert.equal(single.vertices, 1);
  const two = pickBnmPosition(
    'AT POSITION 39°49.068’N 75°23.334’W AND 39°49.728’N 75°22.332’W',
  );
  assert.equal(two.polygon, false);
  assert.equal(two.vertices, 2);
  assert.ok(Math.abs(two.lat - 39.8178) < 1e-4);
  assert.equal(pickBnmPosition('no positions here'), null);
  assert.equal(positionFromPoints('x', []), null);
});

test('parseCancelAt reads CANCEL AT//DDHHMMZ MON YY// as UTC', () => {
  assert.equal(
    parseCancelAt('CANCEL AT//220000Z NOV 26//'),
    Date.parse('2026-11-22T00:00:00Z'),
  );
  assert.equal(
    parseCancelAt('CANCEL AT//240100Z NOV 26//'),
    Date.parse('2026-11-24T01:00:00Z'),
  );
  assert.equal(parseCancelAt('no cancel here'), null);
  assert.equal(parseCancelAt('CANCEL AT//321200Z NOV 26//'), null); // day 32
  assert.equal(parseCancelAt('CANCEL AT//222500Z NOV 26//'), null); // hour 25
  assert.equal(parseCancelAt('CANCEL AT//220000Z FOO 26//'), null); // bad month
  assert.equal(parseCancelAt('CANCEL AT//310000Z FEB 26//'), null); // Feb 31
  assert.equal(parseCancelAt(null), null);
});

test('severityForWarning is the documented heuristic', () => {
  const sev = (criticality, descriptor) =>
    severityForWarning({ criticality, descriptor, body: '' });
  assert.equal(sev('SAFETY', 'HAZ OPS'), 'high');
  assert.equal(sev('SAFETY', 'RIGHT WHALE SLOW ZONE'), 'high');
  assert.equal(sev('SAFETY', 'DREDGING'), 'high');
  assert.equal(sev('SAFETY', 'MARINE EVENTS'), 'high');
  assert.equal(sev('SAFETY', 'BRIDGE'), 'high');
  assert.equal(sev('SAFETY', 'ATON'), 'moderate');
  assert.equal(sev('SAFETY', 'SOMETHING ELSE'), 'moderate');
  assert.equal(sev('SCHEDULED', 'ATON'), 'low');
  assert.equal(sev('CANCELLATION', 'ATON'), 'info');
  assert.equal(sev('UPDATE', 'ATON'), 'moderate');
  assert.equal(sev(null, null), 'moderate');
});

test('normalizeMarineWarningsSnapshot rejects malformed payloads', () => {
  assert.equal(normalizeMarineWarningsSnapshot(null), null);
  assert.equal(normalizeMarineWarningsSnapshot([]), null);
  assert.equal(normalizeMarineWarningsSnapshot({}), null);
  assert.equal(normalizeMarineWarningsSnapshot({ items: 'nope' }), null);
  assert.deepEqual(normalizeMarineWarningsSnapshot({ items: [] }), {
    rows: [],
    cancelledCount: 0,
    totalItems: 0,
    pinnedCount: 0,
    listOnlyCount: 0,
  });
  // Non-object items are skipped, not fatal.
  assert.deepEqual(
    normalizeMarineWarningsSnapshot({ items: [null, 'x', 42] }).rows,
    [],
  );
});

test('cancellations tombstone their targets and are never displayed', () => {
  const target = item(
    'SAFETY/DE - DELAWARE BAY/ATON/SEC SDB BNM 0283-26',
    '<p>1. BROWN SHOAL LIGHT (LLNR 1535) HAS BEEN SET IN APPROX POSITION 38-55.35 N 075-06.01 W. CANCEL AT//130000Z NOV 26//</p>',
    'Thu, 13 Nov 2026 10:00:00 -0600',
  );
  const cancel = item(
    'CANCELLATION/SEC SDB BNM 0283-26',
    '<p>1. CANCEL SEC SDB BNM 0283-26 DTG 052312Z NOV 26 A. AID NAME: BROWN SHOAL LIGHT B. LLNR: 1535</p>',
    'Fri, 14 Nov 2026 10:00:00 -0600',
  );
  // At Oct 14 the target is still in force, so the tombstone counts.
  const atOct = normalizeMarineWarningsSnapshot(
    { items: [target, cancel] },
    { now: Date.parse('2026-10-14T00:00:00Z') },
  );
  assert.deepEqual(atOct.rows, []);
  assert.equal(atOct.cancelledCount, 1);
  // At Nov 16 the target is expired anyway — the tombstone is not news.
  const atNov = normalizeMarineWarningsSnapshot(
    { items: [target, cancel] },
    { now: NOW },
  );
  assert.deepEqual(atNov.rows, []);
  assert.equal(atNov.cancelledCount, 0);
});

test('a multi-cancellation removes every listed target', () => {
  const mkTarget = (n) =>
    item(
      `SAFETY/DELAWARE RIVER/ATON/SEC SDB BNM 0${n}-26`,
      '<p>1. INDIAN RIVER INLET BUOY 11 (LLNR 4400) RPTD EXT. CANCEL AT//021213Z DEC 26//</p>',
    );
  const multi = item(
    'CANCELLATION - MULTIPLE/SEC SDB',
    '<p>1. SEC SDB BNM 0240-26 DTG 021213Z OCT 26 A. AID NAME: INDIAN RIVER INLET BUOY 11 ' +
      '2. SEC SDB BNM 0241-26 DTG 021221Z OCT 26 A. AID NAME: INDIAN RIVER INLET BUOY 12</p>',
  );
  const result = normalizeMarineWarningsSnapshot(
    { items: [mkTarget(240), mkTarget(241), multi] },
    { now: NOW },
  );
  assert.deepEqual(result.rows, []);
  assert.equal(result.cancelledCount, 2);
});

test('expired cancelAt drops the row; future cancelAt keeps it', () => {
  const expired = item(
    'SAFETY/NEW JERSEY INTRACOASTAL WATERWAY/DREDGING/SEC SDB BNM 0285-26',
    '<p>1. MAINTENANCE DREDGING OF THE NEW JERSEY INTRACOASTAL WATERWAY NEAR GREAT BAY, NJ. CANCEL AT//140100Z NOV 26//</p>',
  );
  const future = item(
    'SAFETY/DELAWARE RIVER/ATON/SEC SDB BNM 0288-26',
    '<p>1. LISTON RANGE FRONT LIGHT (LLNR 2445) REPORTED WITH A LOW INTENSITY LIGHT. CANCEL AT//220000Z NOV 26//</p>',
  );
  const result = normalizeMarineWarningsSnapshot(
    { items: [expired, future] },
    { now: NOW },
  );
  assert.deepEqual(
    result.rows.map((row) => row.stableId),
    ['SEC SDB:0288-26'],
  );
  assert.equal(result.rows[0].cancelAtMs, Date.parse('2026-11-22T00:00:00Z'));
  assert.equal(result.rows[0].llnr, '2445');
});

test('dedupe keeps the newest pubDate per stableId', () => {
  const old = item(
    'SAFETY/DELAWARE RIVER/ATON/SEC SDB BNM 0288-26',
    '<p>1. OLD BODY. CANCEL AT//220000Z NOV 26//</p>',
    'Fri, 13 Nov 2026 04:24:32 -0600',
  );
  const fresh = item(
    'SAFETY/DELAWARE RIVER/ATON/SEC SDB BNM 0288-26',
    '<p>1. NEW BODY (LLNR 2445). CANCEL AT//220000Z NOV 26//</p>',
    'Sat, 14 Nov 2026 04:24:32 -0600',
  );
  const result = normalizeMarineWarningsSnapshot(
    { items: [old, fresh] },
    { now: NOW },
  );
  assert.equal(result.rows.length, 1);
  assert.match(result.rows[0].body, /NEW BODY/);
});

test('filter: positioned rows need the box; list-only rows need a local waterway', () => {
  const inBox = item(
    'SAFETY/NJ-ATLANTIC CITY OPERATING AREA (ACOA)-HAZOPS-WEEK OF 12-18 OCT 26/HAZ OPS/CGD-E BNM 0478-26',
    '<p>1. FIRING EXERCISES 14 OCT 0800-1200 14 39-10N3 074-12W4 38-48N3 073-55W0 38-58N4 074-20W3 39-01N3 074-25W8 CANCEL AT//190530Z OCT 26//</p>',
    'Sun, 12 Oct 2026 10:00:00 -0400',
  );
  const southHazops = item(
    'SAFETY/NC-CHERRY POINT OPERATING AREA (CPOA)-HAZOPS-WEEK OF 16-22 NOV 26 CHANGE 1/HAZ OPS/CGD-E BNM 0522-26',
    '<p>1. FIRING EXERCISES 21 NOV 0000-2400 17 34-17N5 076-45W2 22 NOV 0000-2400 33-49N9 076-30W6 33-33N2 076-55W3 34-04N1 077-07W1 CANCEL AT//230630Z NOV 26//</p>',
  );
  const northBridge = item(
    'SAFETY/PA – DELAWARE RIVER COMMODORE BARRY BRIDGE/ATON/SEC SDB BNM 0277-26',
    '<p>1. BARGE OPERATIONS AT POSITION 39°49.068’N 75°23.334’W. CANCEL AT//102200Z NOV 26//</p>',
  );
  const localNoPos = item(
    'SAFETY/NJ-ABSECON INLET-CLAM CREEK/ATON/CGD-E BNM 0510-26',
    '<p>1. CLAM CREEK BUOY 2 (LLNR 1245) TEMPORARILY DISESTABLISHED DUE TO DREDGING. CANCEL AT//161835Z NOV 26//</p>',
  );
  const farNoPos = item(
    'SAFETY/MD-CHESTER RIVER-KENT ISLAND NARROWS/ATON/CGD-E BNM 0518-26',
    '<p>1. DAYBEACON 9 (LLNR 26445) RELOCATED. CANCEL AT//261955Z NOV 26//</p>',
  );
  const result = normalizeMarineWarningsSnapshot(
    { items: [inBox, southHazops, northBridge, localNoPos, farNoPos] },
    { now: Date.parse('2026-10-14T00:00:00Z') },
  );
  // ACOA pins (polygon centroid in box); Absecon stays list-only.
  // CPOA/VCOA polygons are south of 38.55; the bridge position is north
  // of 39.75 despite the local area; Chester River has no position and no
  // local waterway.
  assert.deepEqual(
    result.rows.map(
      (row) => `${row.stableId}:${row.hasPosition ? 'pin' : 'list'}`,
    ),
    ['CGD-E:0510-26:list', 'CGD-E:0478-26:pin'],
  );
  assert.equal(result.rows[0].severity, 'moderate');
  assert.equal(result.rows[0].lat, null);
  assert.equal(result.rows[1].severity, 'high');
  assert.equal(result.rows[1].polygon, true);
});

test('rows sort newest-first', () => {
  const mk = (n, pubDate) =>
    item(
      `SAFETY/DELAWARE RIVER/ATON/SEC SDB BNM 0${n}-26`,
      '<p>1. LIGHT (LLNR 1000) RPTD EXT. CANCEL AT//220000Z NOV 26//</p>',
      pubDate,
    );
  const result = normalizeMarineWarningsSnapshot(
    {
      items: [
        mk(280, 'Wed, 11 Nov 2026 10:25:10 -0600'),
        mk(289, 'Sun, 15 Nov 2026 20:43:18 -0600'),
      ],
    },
    { now: NOW },
  );
  assert.deepEqual(
    result.rows.map((row) => row.stableId),
    ['SEC SDB:0289-26', 'SEC SDB:0280-26'],
  );
});

test('live fixtures: parse rate and kept rows are recorded, not assumed', () => {
  const sdbXml = readFileSync(
    new URL('./fixtures/sdb-feed.sample.xml', import.meta.url),
    'utf8',
  );
  const d5Xml = readFileSync(
    new URL('./fixtures/d5-feed.sample.xml', import.meta.url),
    'utf8',
  );
  const items = [...extractRssItems(sdbXml), ...extractRssItems(d5Xml)];
  assert.equal(items.length, 15);
  // Position parse rate over the verbatim fixture items: 8 of 15 carry a
  // parseable position — Brown Shoal, Commodore Barry Bridge, Manasquan,
  // Right Whale Slow Zone, CPOA, VCOA, ACOA, Chester River. (The live
  // feeds measure 60/200; most positioned items are HAZOPS polygons far
  // outside the box, so the kept-set pin rate is far lower.)
  const withPosition = items.filter(
    (entry) => parseBnmPositions(stripBnmHtml(entry.description)).length > 0,
  );
  assert.equal(withPosition.length, 8);
  // At 2026-10-14 (before the ACOA cancelAt): 6 in force, 1 pinned.
  const atOct = normalizeMarineWarningsSnapshot(
    { items },
    { now: Date.parse('2026-10-14T00:00:00Z') },
  );
  assert.equal(atOct.totalItems, 15);
  assert.equal(atOct.rows.length, 6);
  assert.equal(atOct.pinnedCount, 1);
  assert.equal(atOct.listOnlyCount, 5);
  assert.equal(atOct.cancelledCount, 1);
  const pinned = atOct.rows.find((row) => row.hasPosition);
  assert.equal(pinned.stableId, 'CGD-E:0478-26');
  assert.ok(Math.abs(pinned.lat - 38.9929) < 1e-4);
  assert.ok(Math.abs(pinned.lon - -74.2229) < 1e-4);
  assert.equal(pinned.polygon, true);
  // At the live re-check moment (2026-11-16 05:44 UTC): the dredging
  // notice and the ACOA polygon have expired, and the Brown Shoal
  // cancellation no longer counts (its target is expired too).
  const atNov = normalizeMarineWarningsSnapshot({ items }, { now: NOW });
  assert.equal(atNov.rows.length, 4);
  assert.equal(atNov.pinnedCount, 0);
  assert.equal(atNov.listOnlyCount, 4);
  assert.equal(atNov.cancelledCount, 0);
});
