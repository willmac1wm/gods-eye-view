/**
 * APRS / CWOP weather-station registry — the single source of truth for the
 * batched aprs.fi `name=` list. Lookup is by name only (the API has no
 * wildcard search), so stations are hard-coded here, not discovered at
 * runtime.
 *
 * Discovery: findu wxnear + wxqa NJ members, verified live 2026-11-15
 * ~21:46 EST and re-checked 2026-11-16 ~03:34 UTC (22:34 EST Nov 15).
 * Every station below was reporting within ~5 minutes at re-check.
 *
 * Operative box for THIS layer only: lat 38.9–39.38, lon -75.15–-74.55.
 * The three northern stations sit 0.4–1.9 km north of the 39.35 task-box
 * edge; they are the nearest mainland coverage for the county's northern
 * edge (Ocean City / Upper Twp / Linwood / Northfield / Egg Harbor Twp gap
 * — the county's own stations are only on the barrier island and the
 * southern tip). No further widening.
 *
 * EXCLUDED, with reasons (do not re-add without re-verifying):
 * - DW5057 (Cape May Point, 38.9345/-74.96467): DROPPED at build.
 *   At discovery it read 48 °F against 37–43 °F neighbors; at the
 *   2026-11-16 ~03:34 UTC re-check it STILL read 48 °F while the other
 *   seven stations read 37–42 °F (median 39 °F — 9 °F above median, past
 *   the plan's >5 °F drop rule), and its humidity was 55% against 68–84%
 *   for every neighbor. Sun-exposed / sheltered / stuck sensor. No
 *   correction offset is invented; re-add only if it agrees with neighbors.
 * - KS2D (live 37 °F, age ~3 min at re-check, ~10.8 mi NE of 39.08,-74.85):
 *   EXCLUDED — not a CWOP member and its coordinates are UNKNOWN. The
 *   aprs.fi weather page 403'd, findu gave no coordinates, and wxnear
 *   gives distance/direction only — not precise enough to pin. Resolve via
 *   aprs.fi `what=loc` once APRSFI_API_KEY exists and re-add if it falls
 *   inside the box.
 * - KC2GYU (Upper Twp, 39.1955/-74.7127, in-county): presumed offline —
 *   absent from the current wxqa NJ members page and absent from the live
 *   wxnear top-20 at both discovery and re-check. Re-add only if it
 *   reports again.
 * - Delaware / Delaware Bay side (Overfalls, DW2778, FW0960, N3KJE,
 *   GW5802, FW8525, EW9904): live, but across the bay, outside the box
 *   (lon < -75.15 and/or lat < 38.9). Revisit only if William wants bay
 *   coverage.
 * - KC2DUX-2 "Cape May" and CW0045 "Northfield": stale older wxqa
 *   listings; the live stations are plain KC2DUX (Eldora) and CW8812
 *   (Northfield). Do not add the suffixed/legacy variants.
 */

/** aprs.fi allows at most 20 targets per batched `name=` call. */
export const APRS_MAX_STATIONS_PER_CALL = 20;

/**
 * The six live stations in the operative box. `elevM` is the station
 * elevation from wxqa (metres). Coordinates are the wxqa positions.
 */
export const APRS_STATIONS = Object.freeze([
  Object.freeze({
    callsign: 'KC2DUX',
    place: 'Eldora, Dennis Twp',
    lat: 39.19117,
    lon: -74.82067,
    elevM: 3.58,
  }),
  Object.freeze({
    callsign: 'DW8913',
    place: 'Sea Isle City',
    lat: 39.1535,
    lon: -74.69417,
    elevM: 1.52,
  }),
  Object.freeze({
    callsign: 'FW2611',
    place: 'Ocean City',
    lat: 39.27967,
    lon: -74.5685,
    elevM: 11.28,
  }),
  Object.freeze({
    callsign: 'K2GFM',
    place: 'Egg Harbor Twp',
    lat: 39.3665,
    lon: -74.598,
    elevM: 11,
  }),
  Object.freeze({
    callsign: 'CW8812',
    place: 'Northfield',
    lat: 39.36683,
    lon: -74.57117,
    elevM: 4.5,
  }),
  Object.freeze({
    callsign: 'FW6400',
    place: 'Linwood',
    lat: 39.353375,
    lon: -74.567241,
    elevM: 9,
  }),
]);

/** Callsigns, upper-cased, as the batched aprs.fi `name=` value. */
export function aprsStationNames(stations = APRS_STATIONS) {
  if (!Array.isArray(stations) || stations.length === 0)
    throw new Error('APRS station registry is empty');
  if (stations.length > APRS_MAX_STATIONS_PER_CALL)
    throw new Error(
      `APRS station registry exceeds the ${APRS_MAX_STATIONS_PER_CALL}-target batch limit`,
    );
  const names = stations.map((station) => {
    const callsign = String(station?.callsign ?? '').trim().toUpperCase();
    if (!callsign) throw new Error('APRS station registry has a blank callsign');
    return callsign;
  });
  if (new Set(names).size !== names.length)
    throw new Error('APRS station registry has a duplicate callsign');
  return names.join(',');
}
