/**
 * Space weather / Kp card policy constants.
 *
 * All products are NOAA SWPC, keyless, public domain. The card is honest
 * about mid-latitude aurora: at 39°N the "look north tonight" threshold
 * is Kp 7 (G3). Kp 5 (G1) brings possible GPS/HF effects, never visible
 * aurora in Cape May County — the card must never imply otherwise.
 */
export const LAYER_ID = 'space-weather';
export const SPACE_WEATHER_REFRESH_MS = 5 * 60 * 1000;
/** Kp at which aurora may reach the northern Mid-Atlantic. */
export const AURORA_VISIBLE_KP = 7;
/** Kp at which aurora is possible over Cape May itself. */
export const AURORA_OVERHEAD_KP = 8;
