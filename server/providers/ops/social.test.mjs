import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeSocialItem } from './social.js';

test('normalizeSocialItem maps board wire and detects platform', () => {
  const item = normalizeSocialItem(
    {
      title: 'Rip current alert',
      town: 'Wildwood',
      source: 'NWS',
      url: 'https://x.com/NWS/status/1',
      created_at: '2026-11-05T12:00:00Z',
    },
    'board-wire',
  );
  assert.equal(item.platform, 'x');
  assert.equal(item.town, 'Wildwood');
  assert.equal(item.title, 'Rip current alert');
  assert.ok(item.id);
});

test('normalizeSocialItem rejects empty payloads', () => {
  assert.equal(normalizeSocialItem({}), null);
  assert.equal(normalizeSocialItem(null), null);
});
