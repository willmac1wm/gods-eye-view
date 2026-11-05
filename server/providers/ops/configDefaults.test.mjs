import assert from 'node:assert/strict';
import test from 'node:test';
import {
  INTERVAL_CLAMP_MS,
  defaultManagerConfig,
  normalizeManagerConfig,
} from './configDefaults.js';

test('normalizeManagerConfig clamps intervals and fills defaults', () => {
  const cfg = normalizeManagerConfig({
    intervalsMs: { social: 1, place: 10, strip: 5_000 },
    viewability: { social: false, unknownDesk: true },
    sources: { place: { format: 'firewire' } },
    ai: { briefOverride: 'hello', notes: 'ignored client note' },
  });
  assert.equal(cfg.intervalsMs.social, INTERVAL_CLAMP_MS.min);
  assert.equal(cfg.intervalsMs.place, INTERVAL_CLAMP_MS.placeMin);
  assert.equal(cfg.intervalsMs.strip, INTERVAL_CLAMP_MS.stripMin);
  assert.equal(cfg.viewability.social, false);
  assert.equal(cfg.viewability.board, true);
  assert.equal(cfg.sources.place.format, 'firewire');
  assert.equal(cfg.sources.place.demoFixtures, false);
  assert.equal(cfg.sources.liveatc.links, true);
  assert.equal(cfg.ai.briefOverride, 'hello');
  assert.match(cfg.ai.notes, /Fire Wire doctrine/);
  assert.equal(cfg.placeSections.codeEnforcement, true);
  assert.equal(cfg.globe.layers['cape-cad'], true);
});

test('normalizeManagerConfig honors liveatc + place demo toggles', () => {
  const cfg = normalizeManagerConfig({
    sources: {
      liveatc: { links: false },
      place: { format: 'native', demoFixtures: true },
    },
  });
  assert.equal(cfg.sources.liveatc.links, false);
  assert.equal(cfg.sources.place.demoFixtures, true);
});

test('defaultManagerConfig is complete', () => {
  const d = defaultManagerConfig();
  assert.equal(d.version, 1);
  assert.ok(d.intervalsMs.messages >= INTERVAL_CLAMP_MS.min);
  assert.equal(d.approvals.requireManagerForMessages, false);
  assert.equal(d.sources.liveatc.links, true);
  assert.equal(d.sources.place.demoFixtures, false);
});
