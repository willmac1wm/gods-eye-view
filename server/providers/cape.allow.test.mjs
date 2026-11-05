import assert from 'node:assert/strict';
import test from 'node:test';
import { capeAllowed } from './cape.js';

test('capeAllowed permits Place desk soft Fire Wire paths', () => {
  assert.equal(capeAllowed('place'), true);
  assert.equal(capeAllowed('permits'), true);
  assert.equal(capeAllowed('code_enforcement'), true);
});

test('capeAllowed still blocks manager/evidence paths', () => {
  assert.equal(capeAllowed('manager/status'), false);
  assert.equal(capeAllowed('evidence/upload'), false);
  assert.equal(capeAllowed('../place'), false);
});
