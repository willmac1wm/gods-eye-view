import assert from 'node:assert/strict';
import test from 'node:test';
import {
  matchAtcAlerts,
  normalizeAtcAlertRules,
} from './atcAlerts.js';

test('matchAtcAlerts finds emergency, squawk, phraseology, callsign', () => {
  const { hits } = matchAtcAlerts(
    'Mayday mayday N123AB declaring emergency squawking 7700 go around',
    {
      callSigns: ['N123AB'],
    },
  );
  const kinds = hits.map((h) => h.kind).sort();
  assert.ok(kinds.includes('emergency'));
  assert.ok(kinds.includes('squawk'));
  assert.ok(kinds.includes('phraseology'));
  assert.ok(kinds.includes('callsign'));
});

test('matchAtcAlerts understands spoken squawk', () => {
  const { hits } = matchAtcAlerts('squawking seven seven zero zero', {});
  assert.ok(hits.some((h) => h.kind === 'squawk' && h.match === '7700'));
});

test('normalizeAtcAlertRules clamps cooldown and lists', () => {
  const rules = normalizeAtcAlertRules({
    enabled: false,
    cooldownSec: 2,
    emergencyLexicon: ['MAYDAY', ''],
    callSigns: ['n1'],
  });
  assert.equal(rules.enabled, false);
  assert.equal(rules.cooldownSec, 5);
  assert.deepEqual(rules.emergencyLexicon, ['MAYDAY']);
  assert.deepEqual(rules.callSigns, ['n1']);
});
