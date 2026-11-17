/**
 * OpenSky position source (state-vector index 16) — how an aircraft's
 * position was derived: ADS-B (0), ASTERIX radar (1), MLAT (2), FLARM (3).
 *
 * Pure data: no Cesium, DOM, or Node imports. The Flights layer already
 * renders every OpenSky contact — ADS-B, MLAT, and FLARM alike — so this
 * module is the whole "OpenSky layer": it carries the one field the
 * normalizer used to drop, labels it, decides which sources get a ring
 * badge, and tallies per-source counts for the layer status line.
 */

/** OpenSky `position_source` codes (state vector index 16). */
export const POSITION_SOURCE = Object.freeze({
  ADS_B: 0,
  ASTERIX: 1,
  MLAT: 2,
  FLARM: 3,
});

/**
 * Normalize a raw `position_source` value to 0–3, or null when absent,
 * non-numeric, or outside the known range. Unknown codes read as unknown,
 * never as ADS-B — a future code must not silently join the default.
 * @param {*} value Raw state-vector index 16 (or a readsb-derived code).
 * @returns {0|1|2|3|null}
 */
export function normalizePositionSource(value) {
  if (value == null || value === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= 3 ? number : null;
}

/**
 * Display label for a position source, or null when unknown.
 * @param {*} value Raw or normalized position source.
 * @returns {'ADS-B'|'ASTERIX'|'MLAT'|'FLARM'|null}
 */
export function positionSourceLabel(value) {
  switch (normalizePositionSource(value)) {
    case POSITION_SOURCE.ADS_B:
      return 'ADS-B';
    case POSITION_SOURCE.ASTERIX:
      return 'ASTERIX';
    case POSITION_SOURCE.MLAT:
      return 'MLAT';
    case POSITION_SOURCE.FLARM:
      return 'FLARM';
    default:
      return null;
  }
}

/**
 * Whether an aircraft's marker gets the non-ADS-B ring badge. MLAT and
 * FLARM are the two multilateration / glider-network sources whose
 * positions come from ground-station timing rather than the aircraft's own
 * ADS-B broadcast. ADS-B (the default) is unbadged; ASTERIX is counted
 * but not badged — radar-derived, rare in the civil feed.
 * @param {*} value Raw or normalized position source.
 * @returns {boolean}
 */
export function isBadgedPositionSource(value) {
  const source = normalizePositionSource(value);
  return source === POSITION_SOURCE.MLAT || source === POSITION_SOURCE.FLARM;
}

/**
 * Map a readsb `type` string to an OpenSky position source. readsb marks
 * multilaterated contacts `mlat` and ADS-B contacts `adsb_icao` /
 * `adsb_other`; anything else (TIS-B, unknown) is unknown, not assumed.
 * @param {*} type readsb aircraft `type` field.
 * @returns {0|2|null}
 */
export function readsbPositionSource(type) {
  const text = String(type || '')
    .trim()
    .toLowerCase();
  if (text === 'mlat') return POSITION_SOURCE.MLAT;
  if (text.startsWith('adsb')) return POSITION_SOURCE.ADS_B;
  return null;
}

/**
 * Tally position sources over one snapshot. Unknown counts contacts whose
 * source was never reported (null), not contacts from an unknown source.
 * @param {Iterable<*>} values Position sources (raw or normalized).
 * @returns {{total:number, adsb:number, asterix:number, mlat:number, flarm:number, unknown:number}}
 */
export function countPositionSources(values) {
  const counts = {
    total: 0,
    adsb: 0,
    asterix: 0,
    mlat: 0,
    flarm: 0,
    unknown: 0,
  };
  for (const value of values ?? []) {
    counts.total += 1;
    switch (normalizePositionSource(value)) {
      case POSITION_SOURCE.ADS_B:
        counts.adsb += 1;
        break;
      case POSITION_SOURCE.ASTERIX:
        counts.asterix += 1;
        break;
      case POSITION_SOURCE.MLAT:
        counts.mlat += 1;
        break;
      case POSITION_SOURCE.FLARM:
        counts.flarm += 1;
        break;
      default:
        counts.unknown += 1;
    }
  }
  return counts;
}

/**
 * Layer status line, e.g. "1,204 aircraft · 11 MLAT · 2 FLARM". Only
 * non-zero non-ADS-B sources are named — ADS-B is the default and needs
 * no segment — so a pure ADS-B fleet reads as just the total.
 * @param {{total:number, asterix?:number, mlat?:number, flarm?:number, unknown?:number}|null|undefined} counts
 * @returns {string|null} Null when there is nothing to count.
 */
export function formatPositionSourceCounts(counts) {
  if (!counts || !Number.isFinite(counts.total) || counts.total <= 0)
    return null;
  const parts = [`${counts.total.toLocaleString('en-US')} aircraft`];
  if (counts.mlat) parts.push(`${counts.mlat} MLAT`);
  if (counts.flarm) parts.push(`${counts.flarm} FLARM`);
  if (counts.asterix) parts.push(`${counts.asterix} ASTERIX`);
  if (counts.unknown) parts.push(`${counts.unknown} unknown source`);
  return parts.join(' · ');
}
