/**
 * NWS alert card policy constants.
 *
 * No new fetch: the card reuses the existing /api/nws proxy
 * (server/providers/nws.js, zones NJZ023 + NJZ024, 60 s cache). Its job
 * is plain-English presentation only — a gloss of the alert type, the
 * severity in plain words, and the NWS instruction text.
 */
export const LAYER_ID = 'nws-alert-card';
export const NWS_ALERT_CARD_REFRESH_MS = 60 * 1000;
