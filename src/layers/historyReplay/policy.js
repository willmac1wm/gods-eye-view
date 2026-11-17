// History / replay (D3) — policy constants.
//
// The data is the sidecar's own store (sidecar/app/history.py, read-only):
// aircraft_history + feed_history, served at /api/history/*. This module
// holds only the presentation policy: the fetch window, the replay step
// and tick, the overlay cohort limit, and the county anchor/bbox.
//
// Replay semantics (pinned in records.js, tested there):
//   - Aircraft: at cursor T, one pin per hex at its latest stored position
//     with seen_at <= T inside the fetched window — "what was in the sky
//     at T", not a trail.
//   - Feed: items with pub_ms in (T - 15 min, T] — what the feed showed
//     just before T.
//   - The fetched window is 1 h ending at the newest stored instant; the
//     row controls page it with ±15 min steps and a Latest refetch. The
//     server caps every call at 500 rows / 24 h; the layer never asks for
//     more than 1 h at a time.
export const HISTORY_LAYER_ID = 'history-replay';
export const HISTORY_OVERLAY_SOURCE_ID = 'history-replay';
export const HISTORY_ATTRIBUTION =
  'Cape Dispatch history — own stored ADS-B + feed records';
export const HISTORY_STATUS_API_URL = '/api/history/status';
export const HISTORY_AIRCRAFT_API_URL = '/api/history/aircraft';
export const HISTORY_FEED_API_URL = '/api/history/feed';
/** One fetched window: the last hour ending at the newest stored instant. */
export const HISTORY_WINDOW_MS = 60 * 60_000;
/** Server cap mirrored client-side: never ask for more than 500 rows. */
export const HISTORY_LIMIT = 500;
/** Row-control step: ±15 minutes per chip tap. */
export const HISTORY_STEP_MS = 15 * 60_000;
/** Playback: 5 minutes of replay time per 1-second tick. */
export const HISTORY_PLAY_STEP_MS = 5 * 60_000;
export const HISTORY_PLAY_TICK_MS = 1000;
/** Feed items shown at cursor T: published in the 15 minutes before T. */
export const HISTORY_FEED_LOOKBACK_MS = 15 * 60_000;
/** Buckets for the row-control jump list: 15 minutes each. */
export const HISTORY_BUCKET_MS = 15 * 60_000;
/** One pin per aircraft at the cursor, at most this many on the map. */
export const HISTORY_OVERLAY_COHORT_LIMIT = 200;
/** County anchor for the summary label (Cape May Court House). */
export const HISTORY_COUNTY_CENTER = Object.freeze({
  lat: 39.0798,
  lon: -74.7625,
});
/** County default bbox (south, west, north, east), as the server expects. */
export const HISTORY_COUNTY_BBOX = Object.freeze([38.9, -75.15, 39.35, -74.55]);
// Marks text for i18n extraction; the UI translates it with t(). Kept local
// because AI tool services import this module outside the browser.
const msg = (text) => text;

/** Aircraft kind labels, in the order the legend shows them. */
export const HISTORY_KIND_LABELS = Object.freeze([
  Object.freeze({ kind: 'air', label: msg('Aircraft') }),
  Object.freeze({ kind: 'mil', label: msg('Military') }),
  Object.freeze({ kind: 'emg', label: msg('Emergency') }),
  Object.freeze({ kind: 'ship', label: msg('Ship') }),
]);
