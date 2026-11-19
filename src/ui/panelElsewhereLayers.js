/**
 * Layers that left the Data Layers list for a tab of the Local panel, because
 * that is where people use them: as county readouts, lists and briefings,
 * read rather than looked at on the map. Some still draw on the map (Replay
 * plots past aircraft and reports where they were; Airport Radio labels the
 * newest transmission at the KACY tower), and that drawing is switched on and
 * off from the same Local panel tab. The layer ids, share tokens and code are
 * unchanged; only the Data Layers row is gone.
 *
 * Layers whose main job is to put something on the map stay in Data Layers
 * even when the Local panel also offers a switch for them (FAA Status's
 * ellipses at affected airports, VDL2's pins at aircraft positions).
 *
 * One that is on (switched on from the Local panel, an old share link or a
 * voice command) gets a Data Layers row under LOCAL for as long as it is on,
 * so it can always be switched off from Data Layers too.
 *
 * The Local panel is English-only, so where each layer lives is English text.
 */
const COUNTY = 'Local panel · County tab';
const NEWS = 'Local panel · News tab';
const REPLAY = 'Local panel · Replay tab';
const CALLS = 'Local panel · Calls tab';

/** Layer id → where it lives now (English). */
export const ELSEWHERE = Object.freeze({
  'fuel-prices': COUNTY,
  'space-weather': COUNTY,
  drought: COUNTY,
  radiation: COUNTY,
  outbreaks: COUNTY,
  'internet-outages': COUNTY,
  'disaster-history': COUNTY,
  'county-risk': COUNTY,
  readiness: COUNTY,
  'daily-brief': NEWS,
  'credibility-scoring': NEWS,
  'history-replay': REPLAY,
  'airport-radio': CALLS,
});

/** Whether `layerId` lives outside the Data Layers list. */
export function isElsewhereLayer(layerId) {
  return typeof layerId === 'string' && Object.hasOwn(ELSEWHERE, layerId);
}

/** Where `layerId` lives now, or '' for a layer Data Layers still lists. */
export function elsewhereLabel(layerId) {
  return isElsewhereLayer(layerId) ? ELSEWHERE[layerId] : '';
}
