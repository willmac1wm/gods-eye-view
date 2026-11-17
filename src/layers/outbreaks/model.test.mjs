// src/layers/outbreaks/model.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createOutbreaksOverlayEntry,
  mapAnalystRecord,
} from './model.js';

// Verbatim live snapshot shape from 2026-11-17 (NJ 35, Cape May zero,
// DON626 MERS–Qatar + DON625 Ebola).
const LIVE_SNAPSHOT = {
  fetchedAt: 1_793_123_456_789,
  stale: false,
  arbonet: {
    ok: true,
    asOf: 'November 10, 2026',
    status: 'preliminary',
    states: [
      { kind: 'state', state: 'NJ', cases: 35, band: '>25', source: 'CDC ArboNET' },
      { kind: 'state', state: 'CA', cases: 527, band: '>25', source: 'CDC ArboNET' },
    ],
    njCounties: [
      {
        kind: 'county',
        fips: '34009',
        county: 'Cape May',
        activity: 'Non-human activity',
        humanCases: 0,
        neuroinvasive: 0,
        donors: 0,
        source: 'CDC ArboNET',
      },
      {
        kind: 'county',
        fips: '34001',
        county: 'Atlantic',
        activity: 'Human infections and non-human activity',
        humanCases: 2,
        neuroinvasive: 2,
        donors: 0,
        source: 'CDC ArboNET',
      },
    ],
  },
  don: {
    ok: true,
    items: [
      {
        kind: 'don',
        id: 'DON626',
        title: 'Middle East respiratory syndrome (MERS) – Qatar',
        date: '13 November 2026',
        dateIso: '2026-11-13T00:00:00.000Z',
        url: 'https://www.who.int/2026-DON626',
        source: 'WHO DON',
      },
    ],
  },
  counts: {
    states: 2,
    njCounties: 2,
    don: 1,
    njCases: 35,
    capeMayHumanCases: 0,
  },
  capeMay: {
    kind: 'county',
    fips: '34009',
    county: 'Cape May',
    activity: 'Non-human activity',
    humanCases: 0,
    neuroinvasive: 0,
    donors: 0,
    source: 'CDC ArboNET',
  },
};

test('the anchor label reports NJ 35 and Cape May non-human activity', () => {
  const entry = createOutbreaksOverlayEntry({ snapshot: LIVE_SNAPSHOT });
  assert.equal(entry.id, 'outbreaks');
  assert.match(entry.title, /35/);
  assert.match(entry.subtitle, /Non-human activity/);
  assert.match(entry.subtitle, /1 WHO alerts/);
  // Amber watch accent while Cape May has no human cases (Cesium converts
  // the hex to rgb — compare against the conversion, not the hex).
  assert.equal(entry.accent, 'rgb(255,196,107)');
  assert.equal(entry.priority, 1);
  assert.equal(entry.variant, 'label');
});

test('a Cape May human case turns the anchor red and urgent', () => {
  const snapshot = {
    ...LIVE_SNAPSHOT,
    capeMay: { ...LIVE_SNAPSHOT.capeMay, humanCases: 1 },
    counts: { ...LIVE_SNAPSHOT.counts, capeMayHumanCases: 1 },
  };
  const entry = createOutbreaksOverlayEntry({ snapshot });
  assert.match(entry.subtitle, /1 human cases in Cape May Co\./);
  assert.equal(entry.accent, 'rgb(255,107,107)');
  assert.equal(entry.priority, 2);
});

test('the analyst seam dispatches on the row kind and keeps the source label', () => {
  const state = mapAnalystRecord(
    { kind: 'state', state: 'NJ', cases: 35, band: '>25' },
    0,
  );
  assert.equal(state.kind, 'state');
  assert.equal(state.id, 'ARBONET-STATE-NJ');
  assert.equal(state.source, 'CDC ArboNET');
  const county = mapAnalystRecord(
    {
      kind: 'county',
      fips: '34009',
      county: 'Cape May',
      activity: 'Non-human activity',
      humanCases: 0,
      neuroinvasive: 0,
      donors: 0,
    },
    1,
  );
  assert.equal(county.kind, 'county');
  assert.equal(county.id, 'ARBONET-COUNTY-34009');
  assert.equal(county.source, 'CDC ArboNET');
  const don = mapAnalystRecord(
    {
      kind: 'don',
      id: 'DON626',
      title: 'Middle East respiratory syndrome (MERS) – Qatar',
      date: '13 November 2026',
      dateIso: '2026-11-13T00:00:00.000Z',
      url: 'https://www.who.int/2026-DON626',
    },
    2,
  );
  assert.equal(don.kind, 'don');
  assert.equal(don.id, 'DON626');
  assert.equal(don.source, 'WHO DON');
});
