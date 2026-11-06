import assert from 'node:assert/strict';
import test from 'node:test';
import {
  iceCastUrlForMount,
  resolveAllowedStreamUrl,
  rewriteAtcAudioUrl,
} from './atcMounts.js';

test('iceCastUrlForMount builds allowlisted Icecast URL', () => {
  assert.equal(
    iceCastUrlForMount('kacy_a_twr'),
    'http://d.liveatc.net/kacy_a_twr',
  );
});

test('resolveAllowedStreamUrl respects enabled flag', () => {
  assert.ok(resolveAllowedStreamUrl('kacy_a_twr'));
  assert.ok(resolveAllowedStreamUrl('kmiv_awos'));
  assert.equal(
    resolveAllowedStreamUrl('kmiv_awos', [
      { id: 'kmiv_awos', mount: 'kmiv_awos', enabled: false },
    ]),
    null,
  );
});

test('rewriteAtcAudioUrl maps LiveATC hosts onto same-origin proxy', () => {
  assert.equal(
    rewriteAtcAudioUrl('http://d.liveatc.net/kacy_a_twr'),
    '/api/ops/atc/stream?mount=kacy_a_twr',
  );
  assert.equal(rewriteAtcAudioUrl('https://evil.example/stream'), '');
});
