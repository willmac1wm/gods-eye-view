// AI situation (D1) — policy constants.
//
// The AI layer is three pieces on the free Gemini key already held:
// a daily situation brief (D5 builds it — this layer does not duplicate
// it), a situation Q&A that answers only from stored records, and a
// rules-first forecaster. This module holds only the presentation
// policy: the endpoints, the refresh cadence, the retrieval caps, the
// suggested questions, and the "Unofficial" banner text.
//
// The row-controls renderer has no free-text input, so v1 ships the Q&A
// as suggested-question chips — each chip POSTs its question to /api/qa
// and the answer renders in the list (with citations + the Unofficial
// banner + confidence). The /api/qa endpoint itself accepts ANY question
// text; only the UI ships chips in v1. A free-text Q&A box is a
// follow-on (it needs a text-input row control in layerPanel.js).
//
// Rules the layer never breaks: never invent a position; never republish
// raw ACARS/dispatch text (the retriever excludes raw_json and dispatch
// text at the query level); never claim certainty without a confidence
// number; never present model output as official guidance (the
// "Unofficial" banner stays; evacuation/safety instructions come only
// from official sources — NWS, county OEM, FEMA — quoted and linked).
export const AI_SITUATION_LAYER_ID = 'ai-situation';
export const AI_SITUATION_OVERLAY_SOURCE_ID = 'ai-situation';
export const AI_SITUATION_ATTRIBUTION =
  'Cape Dispatch AI situation — retrieval-grounded Q&A and rules-first forecaster over stored county records; unofficial, not official guidance';
export const AI_SITUATION_QA_URL = '/api/qa';
export const AI_SITUATION_PREDICTIONS_URL = '/api/predictions';
export const AI_SITUATION_STATUS_URL = '/api/ai/status';
/** The forecaster runs every 6 h + on a critical alert; 15 minutes is plenty. */
export const AI_SITUATION_REFRESH_MS = 15 * 60_000;
/** The retriever caps at 20 records per question (sidecar rule). */
export const AI_SITUATION_RETRIEVAL_LIMIT = 20;
/** County anchor for the summary label (Cape May Court House). */
export const AI_SITUATION_COUNTY_CENTER = Object.freeze({
  lat: 39.0798,
  lon: -74.7625,
});
// Marks text for i18n extraction; the UI translates it with t(). Kept local
// because AI tool services import this module outside the browser.
const msg = (text) => text;

/** The "Unofficial" banner, carried on every answer. */
export const AI_SITUATION_UNOFFICIAL_BANNER = msg(
  'Unofficial — not official guidance. Call 911 for emergencies.',
);
/** The no-record answer, exactly as the sidecar returns it. */
export const AI_SITUATION_NO_RECORD = msg("I don't have a record of that");
/** The no-key answer, exactly as the sidecar returns it. */
export const AI_SITUATION_WRITER_OFF = msg('writer not configured');

/** Suggested questions (chips). The API accepts any question text; the UI ships these in v1. */
export const AI_SITUATION_SUGGESTED_QUESTIONS = Object.freeze([
  msg('What is happening in the county right now?'),
  msg('Is flooding expected?'),
  msg('Are there outages?'),
  msg('Any military flights?'),
]);
