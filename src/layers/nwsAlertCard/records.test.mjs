import assert from 'node:assert/strict';
import test from 'node:test';
import {
  NWS_ALERT_GLOSS,
  isCancelledAlert,
  normalizeNwsAlertCard,
  normalizeNwsAlertSnapshot,
  severityWords,
  validateNwsAlertSnapshot,
} from './records.js';

// Live NWS rows for NJZ023, Nov 13–14 2026 (api.weather.gov).
const FREEZE_WARNING = {
  id: 'https://api.weather.gov/alerts/NWS-IDP-PROD-1',
  event: 'Freeze Warning',
  headline: 'Freeze Warning issued November 14 at 12:56AM EST until November 14 at 9:00AM EST by NWS Mount Holly',
  area: 'Cape May',
  severity: 'Severe',
  instruction: 'Take steps now to protect tender plants from the cold.',
  description: 'Sub-freezing temperatures are expected.',
  effective: '2026-11-14T05:56:00+00:00',
  expires: '2026-11-14T14:00:00+00:00',
  onset: '2026-11-14T05:56:00+00:00',
  senderName: 'NWS Mount Holly NJ',
  geometry: null,
};

const COASTAL_FLOOD_ADVISORY = {
  id: 'https://api.weather.gov/alerts/NWS-IDP-PROD-2',
  event: 'Coastal Flood Advisory',
  headline: 'Coastal Flood Advisory issued November 13 at 2:47PM EST until November 13 at 3:00PM EST by NWS Mount Holly',
  area: 'Cape May',
  severity: 'Minor',
  instruction: null,
  description: 'Minor coastal flooding is expected.',
  effective: '2026-11-13T19:47:00+00:00',
  expires: '2026-11-13T20:00:00+00:00',
  onset: '2026-11-13T19:47:00+00:00',
  senderName: 'NWS Mount Holly NJ',
  geometry: null,
};

const CANCELLED_FREEZE = {
  ...FREEZE_WARNING,
  id: 'https://api.weather.gov/alerts/NWS-IDP-PROD-3',
  headline: 'The Freeze Warning has been cancelled.',
};

test('normalizeNwsAlertCard glosses the live Freeze Warning fixture', () => {
  const card = normalizeNwsAlertCard(FREEZE_WARNING);
  assert.equal(card.event, 'Freeze Warning');
  assert.equal(card.plain, 'Hard freeze tonight');
  assert.equal(card.severityWords, 'serious — act now');
  assert.match(card.means, /burst exposed pipes/);
  // The NWS instruction wins over the gloss fallback action.
  assert.equal(
    card.action,
    'Take steps now to protect tender plants from the cold.',
  );
  assert.equal(card.instruction, FREEZE_WARNING.instruction);
  assert.equal(card.effective, '2026-11-14T05:56:00+00:00');
});

test('normalizeNwsAlertCard glosses the live Coastal Flood Advisory fixture', () => {
  const card = normalizeNwsAlertCard(COASTAL_FLOOD_ADVISORY);
  assert.equal(card.plain, 'Minor coastal flooding expected');
  assert.equal(card.severityWords, 'minor — low impact');
  assert.match(card.means, /usual first spots/);
  // No NWS instruction on this one: the gloss fallback action applies.
  assert.equal(card.action, 'Avoid flooded roads; never drive through floodwater.');
});

test('normalizeNwsAlertCard drops cancelled alerts and unglossed types stay headline-only', () => {
  assert.equal(normalizeNwsAlertCard(CANCELLED_FREEZE), null);
  assert.equal(isCancelledAlert('The Freeze Warning has been cancelled.'), true);
  const unknown = normalizeNwsAlertCard({
    ...FREEZE_WARNING,
    event: 'Something New Warning',
  });
  assert.equal(unknown.plain, null);
  assert.equal(unknown.means, null);
  // The NWS instruction is still carried for an unglossed type.
  assert.equal(unknown.action, FREEZE_WARNING.instruction);
  assert.equal(normalizeNwsAlertCard(null), null);
  assert.equal(normalizeNwsAlertCard({ event: '' }), null);
});

test('severityWords covers every NWS severity value', () => {
  assert.equal(severityWords('Extreme'), 'life-threatening');
  assert.equal(severityWords('Severe'), 'serious — act now');
  assert.equal(severityWords('Moderate'), 'be aware and prepare');
  assert.equal(severityWords('Minor'), 'minor — low impact');
  assert.equal(severityWords('Unknown'), 'severity not stated');
  assert.equal(severityWords('Weird'), 'severity not stated');
});

test('normalizeNwsAlertSnapshot keeps zero alerts as a valid empty card', () => {
  const empty = normalizeNwsAlertSnapshot({ nws_alerts: [] });
  assert.deepEqual(empty, { alerts: [] });
  const filled = normalizeNwsAlertSnapshot({
    nws_alerts: [FREEZE_WARNING, COASTAL_FLOOD_ADVISORY, CANCELLED_FREEZE],
  });
  // The cancelled alert is dropped; the two live ones remain.
  assert.equal(filled.alerts.length, 2);
  assert.equal(normalizeNwsAlertSnapshot(null), null);
  assert.equal(normalizeNwsAlertSnapshot({}), null);
  assert.equal(normalizeNwsAlertSnapshot({ nws_alerts: 'nope' }), null);
});

test('the gloss table covers the county common alert types', () => {
  for (const event of [
    'Coastal Flood Advisory',
    'Coastal Flood Warning',
    'Freeze Warning',
    'Frost Advisory',
    'Severe Thunderstorm Warning',
    'Tornado Warning',
    'Winter Storm Warning',
    'High Wind Warning',
    'Dense Fog Advisory',
    'Small Craft Advisory',
  ]) {
    assert.ok(NWS_ALERT_GLOSS[event], event);
    assert.ok(NWS_ALERT_GLOSS[event].plain, event);
    assert.ok(NWS_ALERT_GLOSS[event].action, event);
  }
});

test('validateNwsAlertSnapshot accepts an empty card and rejects a thin one', () => {
  const snapshot = { fetchedAt: 1, stale: false, alerts: [] };
  assert.equal(validateNwsAlertSnapshot(snapshot), snapshot);
  assert.throws(
    () => validateNwsAlertSnapshot({ alerts: [] }),
    /invalid snapshot/,
  );
  assert.throws(
    () =>
      validateNwsAlertSnapshot({
        stale: false,
        alerts: [{ event: '', severityWords: 'x' }],
      }),
    /invalid alert/,
  );
});
