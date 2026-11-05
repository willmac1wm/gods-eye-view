import assert from 'node:assert/strict';
import test from 'node:test';
import { CAPE_STARTER_PACKS, packsByKind } from './capePacks.js';
import { PERMITS_DEMO_CASES, wantsPlaceDemo } from './permitsDemo.js';

test('Cape starter packs load with empty author assets', () => {
  assert.ok(CAPE_STARTER_PACKS.length >= 2);
  for (const pack of CAPE_STARTER_PACKS) {
    assert.ok(pack.id);
    assert.ok(pack.title);
    assert.equal(pack.status, 'stub');
    assert.deepEqual(pack.assets, []);
    assert.ok(Number.isFinite(pack.lat));
    assert.ok(Number.isFinite(pack.lon));
  }
  assert.ok(packsByKind('scene').length >= 1);
  assert.ok(packsByKind('reconstruct').length >= 1);
});

test('permits demo fixtures never invent owner names', () => {
  assert.ok(PERMITS_DEMO_CASES.length >= 1);
  const blob = JSON.stringify(PERMITS_DEMO_CASES).toLowerCase();
  assert.doesNotMatch(blob, /owner|smith|johnson|resident name/);
  assert.equal(wantsPlaceDemo('?demo=1'), true);
  assert.equal(wantsPlaceDemo('?lat=1'), false);
});
