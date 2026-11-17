/**
 * NWS alert plain-English glosses.
 *
 * Live county verification 2026-11-16 (api.weather.gov):
 * - `GET /alerts/active?zone=NJZ023` → HTTP 200, features: [] — zero
 *   active alerts, the expected steady state on a quiet night.
 * - Past alerts (Sep 1 – Nov 16, 2026) returned the fixtures below:
 *   Freeze Warning (Severe), Nov 14 00:56 EST → Nov 14 09:00 EST, and
 *   Coastal Flood Advisory (Minor), Nov 13 14:47 → 15:00 EST (plus a
 *   second advisory that morning). A cancelled Freeze Warning headline
 *   ("The Freeze Warning has been cancelled.") also appears in the feed
 *   — cancelled alerts are dropped, never shown as live.
 *
 * Gloss rules: the table covers the county's common alert types. An
 * event type not in the table renders headline-only — never invent a
 * gloss. Safety instructions come from the NWS `instruction` field
 * verbatim when present; the `action` column is only the fallback when
 * NWS sends no instruction.
 */
export const NWS_ALERT_GLOSS = Object.freeze({
  'Coastal Flood Advisory': Object.freeze({
    plain: 'Minor coastal flooding expected',
    means:
      'Water may cover low roads near the bay and ocean at high tide — the usual first spots flood first.',
    action: 'Avoid flooded roads; never drive through floodwater.',
  }),
  'Coastal Flood Warning': Object.freeze({
    plain: 'Coastal flooding is happening or imminent',
    means: 'Water over roads in low areas.',
    action: 'Do not drive through flooded roads.',
  }),
  'Coastal Flood Watch': Object.freeze({
    plain: 'Coastal flooding is possible',
    means: 'Conditions favor coastal flooding.',
    action: 'Stay weather-aware and check the next tide.',
  }),
  'Freeze Warning': Object.freeze({
    plain: 'Hard freeze tonight',
    means:
      'Temperatures below freezing long enough to kill plants and burst exposed pipes.',
    action: 'Cover plants and protect exposed pipes.',
  }),
  'Frost Advisory': Object.freeze({
    plain: 'Frost overnight',
    means: 'Light frost on grass and cars; tender plants at risk.',
    action: 'Cover tender plants.',
  }),
  'Severe Thunderstorm Warning': Object.freeze({
    plain: 'Dangerous thunderstorm',
    means: 'Damaging wind and/or large hail in the warned area.',
    action: 'Move indoors now.',
  }),
  'Severe Thunderstorm Watch': Object.freeze({
    plain: 'Storms may turn severe',
    means: 'Conditions favor severe storms later.',
    action: 'Stay weather-aware.',
  }),
  'Tornado Warning': Object.freeze({
    plain: 'Tornado — take shelter now',
    means: 'A tornado is happening or imminent.',
    action: 'Take shelter now, lowest floor, interior room.',
  }),
  'Tornado Watch': Object.freeze({
    plain: 'Tornadoes are possible',
    means: 'Conditions favor tornadoes.',
    action: 'Be ready to shelter.',
  }),
  'Tropical Storm Warning': Object.freeze({
    plain: 'Tropical storm expected',
    means: 'Tropical-storm conditions are expected.',
    action: 'Follow county OEM guidance.',
  }),
  'Tropical Storm Watch': Object.freeze({
    plain: 'Tropical storm possible',
    means: 'Tropical-storm conditions are possible.',
    action: 'Follow county OEM guidance.',
  }),
  'Hurricane Warning': Object.freeze({
    plain: 'Hurricane expected',
    means: 'Hurricane conditions are expected.',
    action: 'Follow county OEM guidance.',
  }),
  'Hurricane Watch': Object.freeze({
    plain: 'Hurricane possible',
    means: 'Hurricane conditions are possible.',
    action: 'Follow county OEM guidance.',
  }),
  'Winter Storm Warning': Object.freeze({
    plain: 'Major winter storm',
    means: 'Heavy snow — travel will be dangerous or impossible.',
    action: 'Avoid travel; follow county OEM guidance.',
  }),
  'Winter Storm Watch': Object.freeze({
    plain: 'Winter storm possible',
    means: 'Heavy snow is possible.',
    action: 'Stay weather-aware.',
  }),
  'Blizzard Warning': Object.freeze({
    plain: 'Blizzard',
    means: 'Blowing snow and whiteout conditions.',
    action: 'Avoid travel.',
  }),
  'High Wind Warning': Object.freeze({
    plain: 'Damaging winds',
    means: 'Power outages and downed branches possible.',
    action: 'Secure loose items; stay clear of downed lines.',
  }),
  'High Wind Advisory': Object.freeze({
    plain: 'Strong winds',
    means: 'Gusty winds; isolated outages possible.',
    action: 'Secure loose items.',
  }),
  'Dense Fog Advisory': Object.freeze({
    plain: 'Thick fog',
    means: 'Visibility under a quarter mile on roads.',
    action: 'Slow down; use low beams.',
  }),
  'Excessive Heat Warning': Object.freeze({
    plain: 'Dangerous heat',
    means: 'Heat illness risk.',
    action: 'Hydrate, seek shade, check on neighbors.',
  }),
  'Excessive Heat Advisory': Object.freeze({
    plain: 'Dangerous heat',
    means: 'Heat illness risk.',
    action: 'Hydrate, seek shade, check on neighbors.',
  }),
  'Small Craft Advisory': Object.freeze({
    plain: 'Hazardous boating conditions',
    means: 'Inexperienced mariners should stay in port (Delaware Bay).',
    action: 'Stay in port if inexperienced.',
  }),
});

export const NWS_SEVERITY_WORDS = Object.freeze({
  Extreme: 'life-threatening',
  Severe: 'serious — act now',
  Moderate: 'be aware and prepare',
  Minor: 'minor — low impact',
  Unknown: 'severity not stated',
});

function textValue(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

/** Whether an NWS headline says the alert was cancelled. */
export function isCancelledAlert(headline) {
  return /has been cancelled/i.test(String(headline ?? ''));
}

/** Plain-words severity for an NWS severity value. */
export function severityWords(severity) {
  return NWS_SEVERITY_WORDS[severity] ?? NWS_SEVERITY_WORDS.Unknown;
}

/**
 * Map one provider alert row to a plain-English card record. Null for
 * anything unusable or cancelled.
 * @param {object} alert - provider alert ({ id, event, headline, area, severity, … })
 * @returns {object|null}
 */
export function normalizeNwsAlertCard(alert) {
  if (!alert || typeof alert !== 'object' || Array.isArray(alert)) return null;
  const event = textValue(alert.event);
  if (!event) return null;
  if (isCancelledAlert(alert.headline)) return null;
  const gloss = NWS_ALERT_GLOSS[event] ?? null;
  return {
    id: textValue(alert.id),
    event,
    headline: textValue(alert.headline),
    area: textValue(alert.area),
    severity: textValue(alert.severity),
    severityWords: severityWords(alert.severity),
    plain: gloss?.plain ?? null,
    means: gloss?.means ?? null,
    action: textValue(alert.instruction) ?? gloss?.action ?? null,
    instruction: textValue(alert.instruction),
    description: textValue(alert.description),
    effective: textValue(alert.effective),
    expires: textValue(alert.expires),
    onset: textValue(alert.onset),
    senderName: textValue(alert.senderName),
  };
}

/**
 * Normalize a whole /api/nws payload into a card snapshot. A payload
 * with no alerts is valid (zero active alerts is the steady state) —
 * only a malformed payload returns null.
 * @param {*} payload - /api/nws JSON
 * @returns {{alerts: Array}|null}
 */
export function normalizeNwsAlertSnapshot(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    return null;
  if (!Array.isArray(payload.nws_alerts)) return null;
  return {
    alerts: payload.nws_alerts.map(normalizeNwsAlertCard).filter(Boolean),
  };
}

/**
 * Validate a card snapshot before it can replace the displayed card.
 * @param {*} snapshot - card snapshot
 * @returns {object} the snapshot, unchanged
 */
export function validateNwsAlertSnapshot(snapshot) {
  if (
    !snapshot ||
    typeof snapshot !== 'object' ||
    !Array.isArray(snapshot.alerts) ||
    typeof snapshot.stale !== 'boolean'
  ) {
    throw new TypeError('NWS alert card source returned an invalid snapshot');
  }
  for (const alert of snapshot.alerts) {
    if (
      !alert ||
      typeof alert.event !== 'string' ||
      !alert.event.trim() ||
      typeof alert.severityWords !== 'string'
    ) {
      throw new TypeError('NWS alert card source returned an invalid alert');
    }
  }
  return snapshot;
}
