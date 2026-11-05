import assert from 'node:assert/strict';
import test from 'node:test';
import {
  managerAllowed,
  tokensMatch,
  resolveManagerToken,
} from './manager.js';

test('managerAllowed permits read tools and blocks uploads', () => {
  assert.equal(managerAllowed('status'), true);
  assert.equal(managerAllowed('review/abc'), true);
  assert.equal(managerAllowed('members'), true);
  assert.equal(managerAllowed('uploads'), false);
  assert.equal(managerAllowed('review/../uploads'), false);
  assert.equal(managerAllowed('evidence'), false);
});

test('tokensMatch is length-safe', () => {
  assert.equal(tokensMatch('secret-token', 'secret-token'), true);
  assert.equal(tokensMatch('secret-token', 'secret-tokex'), false);
  assert.equal(tokensMatch('short', 'longer-token'), false);
  assert.equal(tokensMatch('', 'x'), false);
});

test('resolveManagerToken prefers CAPE_MANAGER_TOKEN', () => {
  assert.equal(
    resolveManagerToken({
      CAPE_MANAGER_TOKEN: ' a ',
      FIREWIRE_MANAGER_TOKEN: 'b',
    }),
    'a',
  );
  assert.equal(
    resolveManagerToken({ FIREWIRE_MANAGER_TOKEN: 'b' }),
    'b',
  );
  assert.equal(resolveManagerToken({}), null);
});
