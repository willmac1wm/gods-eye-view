import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ELSEWHERE,
  elsewhereLabel,
  isElsewhereLayer,
} from './panelElsewhereLayers.js';
import { isPanelHiddenLayer } from './panelHiddenLayers.js';

const BY_TAB = {
  'Local panel · County tab': [
    'fuel-prices',
    'space-weather',
    'drought',
    'radiation',
    'outbreaks',
    'internet-outages',
    'disaster-history',
    'county-risk',
    'readiness',
  ],
  'Local panel · News tab': ['daily-brief', 'credibility-scoring'],
  'Local panel · Replay tab': ['history-replay'],
  'Local panel · Calls tab': ['airport-radio'],
};

test('every layer that left Data Layers names the Local panel tab it lives in', () => {
  const expected = Object.fromEntries(
    Object.entries(BY_TAB).flatMap(([where, ids]) =>
      ids.map((id) => [id, where]),
    ),
  );
  assert.deepEqual(ELSEWHERE, expected);
  for (const [id, where] of Object.entries(expected)) {
    assert.equal(isElsewhereLayer(id), true, id);
    assert.equal(elsewhereLabel(id), where, id);
  }
});

test('the map is frozen and answers no for map layers and non-ids', () => {
  assert.ok(Object.isFrozen(ELSEWHERE));
  // Modules are strict: writing to a frozen object throws.
  assert.throws(() => {
    ELSEWHERE.flights = 'nowhere';
  }, TypeError);
  // FAA Status and VDL2 draw on the map, so they stay in Data Layers even
  // though the Local panel also has switches for them.
  for (const id of [
    'flights',
    'faa-status',
    'vdl2',
    'street-level',
    'recent-imagery',
    'directions',
    'nws-alerts',
    'toString',
    'constructor',
    '__proto__',
    '',
    undefined,
    null,
  ]) {
    assert.equal(isElsewhereLayer(id), false, String(id));
    assert.equal(elsewhereLabel(id), '', String(id));
  }
});

test('a layer that moved elsewhere is not also hidden', () => {
  // Hidden layers are switched off by Local defaults; these are switched on
  // from the Local panel, so the two lists must never overlap.
  assert.deepEqual(
    Object.keys(ELSEWHERE).filter((id) => isPanelHiddenLayer(id)),
    [],
  );
});
