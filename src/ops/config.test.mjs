import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deskVisible,
  intervalFor,
  placeSectionVisible,
  OPS_CONFIG_FALLBACK,
} from './config.js';

test('deskVisible defaults true and honors false', () => {
  assert.equal(deskVisible(null, 'place'), true);
  assert.equal(deskVisible({}, 'place'), true);
  assert.equal(deskVisible({ viewability: { place: false } }, 'place'), false);
  assert.equal(deskVisible({ viewability: { place: true } }, 'place'), true);
});

test('placeSectionVisible honors code enforcement toggle', () => {
  assert.equal(placeSectionVisible(null, 'codeEnforcement'), true);
  assert.equal(
    placeSectionVisible(
      { placeSections: { codeEnforcement: false } },
      'codeEnforcement',
    ),
    false,
  );
});

test('intervalFor reads manager intervals with fallback', () => {
  assert.equal(intervalFor(null, 'place', 300_000), 300_000);
  assert.equal(
    intervalFor({ intervalsMs: { place: 90_000 } }, 'place', 300_000),
    90_000,
  );
  assert.equal(intervalFor(OPS_CONFIG_FALLBACK, 'messages', 15_000), 15_000);
});
