// src/layers/outbreaks/model.js
import * as Cesium from 'cesium';
import { msg } from '../../i18n/marker.js';
import {
  OUTBREAKS_OVERLAY_COHORT_LIMIT,
  OUTBREAKS_OVERLAY_SOURCE_ID,
} from './policy.js';

export { OUTBREAKS_OVERLAY_COHORT_LIMIT };

/** County-seat anchor for the outbreaks ticker overlay label (fuel pattern). */
export const OUTBREAKS_COUNTY_CENTER = Object.freeze({
  lat: 39.0827,
  lon: -74.82,
});

/**
 * One anchor label over the county seat. Outbreaks have no map position
 * of their own — the CDC county table is a table, not pins, and WHO DONs
 * are international headlines — so the label reports the New Jersey West
 * Nile total and the Cape May County activity, and says how many WHO
 * alerts are listed. Counts are CDC's own, shown with their as-of date
 * on the panel; a Cape May row of zero human cases is a real result
 * ("non-human activity"), never an error state.
 */
export function createOutbreaksOverlayEntry({ snapshot } = {}) {
  const njCases = snapshot?.counts?.njCases;
  const capeMay = snapshot?.capeMay ?? null;
  const donCount = snapshot?.counts?.don ?? 0;
  const capeMayHuman = capeMay?.humanCases ?? null;
  const capeMayState =
    capeMay === null
      ? 'Cape May: no data'
      : capeMayHuman > 0
        ? `${capeMayHuman} ${msg('human cases in Cape May Co.')}`
        : `Cape May: ${capeMay.activity ?? 'no human cases'}`;
  return {
    id: OUTBREAKS_OVERLAY_SOURCE_ID,
    position: Cesium.Cartesian3.fromDegrees(
      OUTBREAKS_COUNTY_CENTER.lon,
      OUTBREAKS_COUNTY_CENTER.lat,
    ),
    variant: 'label',
    title: `🦟 ${msg('Outbreaks')} · ${njCases ?? '—'} ${msg('WNV cases in NJ')}`,
    subtitle: `${capeMayState} · ${donCount} ${msg('WHO alerts')}`,
    accent: Cesium.Color.fromCssColorString(
      capeMayHuman > 0 ? '#ff6b6b' : '#ffc46b',
    ).toCssColorString(),
    priority: capeMayHuman > 0 ? 2 : 1,
    collisionGroup: 'ambient-label',
    paintLane: 'ambient-label',
    interactive: false,
    edgeFade: 'keyhole',
    horizonCull: true,
    terrainOcclusion: false,
    gapPx: 15,
    verticalOnly: true,
    placement: 'above',
  };
}

/** Analyst seam. Pure — no Cesium types. Dispatches on the row kind. */
export function mapAnalystRecord(raw, index = 0) {
  const num = (v) => (Number.isFinite(v) ? v : null);
  const text = (v) => {
    const t = String(v ?? '').trim();
    return t || null;
  };
  if (raw?.kind === 'state') {
    return {
      kind: 'state',
      id: text(raw?.state)
        ? `ARBONET-STATE-${raw.state}`
        : `ARBONET-STATE-${String(index).padStart(4, '0')}`,
      state: text(raw?.state),
      cases: num(raw?.cases),
      band: text(raw?.band),
      source: 'CDC ArboNET',
    };
  }
  if (raw?.kind === 'county') {
    return {
      kind: 'county',
      id: text(raw?.fips)
        ? `ARBONET-COUNTY-${raw.fips}`
        : `ARBONET-COUNTY-${String(index).padStart(4, '0')}`,
      fips: text(raw?.fips),
      county: text(raw?.county),
      activity: text(raw?.activity),
      humanCases: num(raw?.humanCases),
      neuroinvasive: num(raw?.neuroinvasive),
      donors: num(raw?.donors),
      source: 'CDC ArboNET',
    };
  }
  return {
    kind: 'don',
    id: text(raw?.id) || `WHO-DON-${String(index).padStart(4, '0')}`,
    title: text(raw?.title),
    date: text(raw?.date),
    dateIso: text(raw?.dateIso),
    url: text(raw?.url),
    source: 'WHO DON',
  };
}
