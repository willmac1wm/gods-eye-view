import { AI_SITUATION_NO_RECORD, AI_SITUATION_WRITER_OFF } from './policy.js';

// Marks text for i18n extraction; the UI translates it with t(). Kept local
// because AI tool services import this module outside the browser.
const msg = (text) => text;

/** Prediction outcomes the store can hold. */
export const AI_SITUATION_OUTCOMES = Object.freeze([
  'open',
  'confirmed',
  'wrong',
]);

/** The no-record and no-key answers, exactly as the sidecar returns them. */
export const AI_SITUATION_ANSWER_KINDS = Object.freeze({
  noRecord: AI_SITUATION_NO_RECORD,
  writerOff: AI_SITUATION_WRITER_OFF,
});

/** Normalize one citation from a /api/qa answer. */
export function normalizeQaCitation(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const text = (v) => {
    const t = String(v ?? '').trim();
    return t || null;
  };
  const recordId = text(raw?.record_id);
  if (!recordId) return null;
  return {
    recordId,
    source: text(raw?.source),
    url: text(raw?.url),
    snippet: text(raw?.snippet),
    claim: text(raw?.claim),
  };
}

/** Normalize a /api/qa answer payload into a snapshot. */
export function normalizeQaAnswer(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const text = (v) => {
    const t = String(v ?? '').trim();
    return t || null;
  };
  const num = (v) => (Number.isFinite(v) ? v : null);
  const answer = text(raw?.answer);
  if (!answer) return null;
  const citations = Array.isArray(raw?.citations)
    ? raw.citations.map(normalizeQaCitation).filter(Boolean)
    : [];
  const closestTopics = Array.isArray(raw?.closest_topics)
    ? raw.closest_topics
        .map((topic) => ({
          title: text(topic?.title),
          recordId: text(topic?.record_id),
        }))
        .filter((topic) => topic.title)
    : [];
  return {
    answer,
    citations,
    confidence: num(raw?.confidence),
    unofficial: raw?.unofficial === true,
    emergencyNote: text(raw?.emergencyNote),
    retrievedAt: num(raw?.retrievedAt),
    closestTopics,
  };
}

/** Validate a normalized Q&A answer. A null answer is malformed; a
 * no-record answer carries no citations and that is valid. */
export function validateQaAnswer(answer) {
  if (!answer || typeof answer !== 'object') return null;
  if (!answer.answer) return null;
  if (!Array.isArray(answer.citations)) return null;
  return answer;
}

/** Normalize one prediction from a /api/predictions row. */
export function normalizePrediction(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const text = (v) => {
    const t = String(v ?? '').trim();
    return t || null;
  };
  const num = (v) => (Number.isFinite(v) ? v : null);
  const body = text(raw?.text);
  if (!body) return null;
  const outcome = text(raw?.outcome);
  return {
    id: num(raw?.id),
    ruleId: text(raw?.rule_id),
    text: body,
    confidence: num(raw?.confidence),
    sourceRecordIds: Array.isArray(raw?.source_record_ids)
      ? raw.source_record_ids.map(String)
      : [],
    whatWouldChangeIt: text(raw?.what_would_change_it),
    outcome: AI_SITUATION_OUTCOMES.includes(outcome) ? outcome : 'open',
    createdAt: num(raw?.created_at),
    validUntil: num(raw?.valid_until),
    checkedAt: num(raw?.checked_at),
    checkedAgainst: text(raw?.checked_against),
  };
}

/** Normalize the whole /api/predictions payload into a snapshot. */
export function normalizePredictionsSnapshot(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const predictions = Array.isArray(payload?.predictions)
    ? payload.predictions.map(normalizePrediction).filter(Boolean)
    : null;
  if (predictions === null) return null;
  const accuracy = payload?.accuracy ?? {};
  const count = (v) => (Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0);
  return {
    predictions,
    accuracy: {
      open: count(accuracy?.open),
      confirmed: count(accuracy?.confirmed),
      wrong: count(accuracy?.wrong),
    },
  };
}

/** Validate a normalized predictions snapshot. */
export function validatePredictionsSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  if (!Array.isArray(snapshot?.predictions)) return null;
  if (!snapshot?.accuracy || typeof snapshot.accuracy !== 'object') return null;
  return snapshot;
}

/** Normalize the /api/ai/status payload. */
export function normalizeAiStatus(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const accuracy = payload?.accuracy ?? {};
  const count = (v) => (Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0);
  const snapshots =
    payload?.snapshots && typeof payload.snapshots === 'object'
      ? payload.snapshots
      : {};
  return {
    writerEnabled: payload?.writer_enabled === true,
    snapshots,
    accuracy: {
      open: count(accuracy?.open),
      confirmed: count(accuracy?.confirmed),
      wrong: count(accuracy?.wrong),
    },
  };
}

/** One-line accuracy record: "3 confirmed · 1 wrong · 2 open". */
export function accuracyLabel(accuracy) {
  if (!accuracy) return msg('No predictions yet');
  const { confirmed = 0, wrong = 0, open = 0 } = accuracy;
  if (confirmed + wrong + open === 0) return msg('No predictions yet');
  return msg(`${confirmed} confirmed · ${wrong} wrong · ${open} open`);
}

/** One-line status for a prediction. A mil-surge pattern note has no
 * checkable outcome by design — it stays open, labeled uncheckable. */
export function predictionStatusLabel(prediction) {
  if (!prediction) return msg('open');
  if (prediction.outcome === 'confirmed') return msg('confirmed');
  if (prediction.outcome === 'wrong') return msg('wrong');
  if (prediction.ruleId === 'mil-surge-pattern')
    return msg('open — outcome uncheckable');
  if (prediction.checkedAgainst === 'outcome uncheckable — still open')
    return msg('open — outcome uncheckable');
  return msg('open');
}

/** Validate a normalized AI-situation snapshot (predictions + writer state). */
export function validateAiSituationSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  if (!Array.isArray(snapshot?.predictions)) return null;
  if (typeof snapshot?.writerEnabled !== 'boolean') return null;
  return snapshot;
}
