/**
 * Deterministic ATC alert matcher — squawks, emergency lexicon, phraseology,
 * call signs. Managers `ai.atc` rules drive detection (no LLM required).
 */

export const DEFAULT_ATC_ALERT_RULES = Object.freeze({
  enabled: true,
  emergencyLexicon: Object.freeze([
    'mayday',
    'pan-pan',
    'pan pan',
    'emergency',
    'declaring an emergency',
    'priority',
  ]),
  squawkCodes: Object.freeze(['7700', '7600', '7500']),
  phraseology: Object.freeze([
    'go around',
    'missed approach',
    'fuel emergency',
    'minimum fuel',
    'unable',
    'say again',
    'blocked',
  ]),
  callSigns: Object.freeze([]),
  promptOverride: '',
  cooldownSec: 60,
});

function normalizeList(value, fallback) {
  if (!Array.isArray(value)) return [...fallback];
  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, 200);
}

export function normalizeAtcAlertRules(raw = {}) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: src.enabled !== false,
    emergencyLexicon: normalizeList(
      src.emergencyLexicon,
      DEFAULT_ATC_ALERT_RULES.emergencyLexicon,
    ),
    squawkCodes: normalizeList(
      src.squawkCodes,
      DEFAULT_ATC_ALERT_RULES.squawkCodes,
    ),
    phraseology: normalizeList(
      src.phraseology,
      DEFAULT_ATC_ALERT_RULES.phraseology,
    ),
    callSigns: normalizeList(src.callSigns, DEFAULT_ATC_ALERT_RULES.callSigns),
    promptOverride:
      typeof src.promptOverride === 'string'
        ? src.promptOverride.slice(0, 8_000)
        : '',
    cooldownSec: Math.min(
      3600,
      Math.max(5, Number(src.cooldownSec) || DEFAULT_ATC_ALERT_RULES.cooldownSec),
    ),
  };
}

function includesPhrase(haystack, needle) {
  const h = haystack.toLowerCase();
  const n = String(needle || '')
    .toLowerCase()
    .trim();
  if (!n) return false;
  // Squawk digits: allow spaced speech ("seven seven zero zero") loosely via digits-only collapse.
  if (/^\d{4}$/.test(n)) {
    const digits = h.replace(/\D+/g, '');
    if (digits.includes(n)) return true;
    const spoken = {
      7700: 'seven seven zero zero',
      7600: 'seven six zero zero',
      7500: 'seven five zero zero',
    };
    if (spoken[n] && h.includes(spoken[n])) return true;
  }
  return h.includes(n);
}

/**
 * @returns {{ hits: Array<{kind:string, match:string}>, text: string }}
 */
export function matchAtcAlerts(transcript, rulesInput) {
  const text = String(transcript || '').trim();
  const rules = normalizeAtcAlertRules(rulesInput);
  if (!rules.enabled || !text) return { hits: [], text };

  const hits = [];
  const push = (kind, match) => {
    if (!hits.some((h) => h.kind === kind && h.match === match)) {
      hits.push({ kind, match });
    }
  };

  for (const word of rules.emergencyLexicon) {
    if (includesPhrase(text, word)) push('emergency', word);
  }
  for (const code of rules.squawkCodes) {
    if (includesPhrase(text, code)) push('squawk', code);
  }
  for (const phrase of rules.phraseology) {
    if (includesPhrase(text, phrase)) push('phraseology', phrase);
  }
  for (const call of rules.callSigns) {
    if (includesPhrase(text, call)) push('callsign', call);
  }

  return { hits, text };
}
