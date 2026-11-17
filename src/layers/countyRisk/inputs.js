// Read the county risk score's inputs from live layer modules (D4).
//
// Pure: given the already-constructed layer modules (or null for a layer
// that is not constructed), map their analyst records + stats to the
// normalized shape scoreCountyRisk() consumes. A layer that is disabled,
// never refreshed, or throws is treated as missing — never as zero, and
// never a crash. No layer reads another layer directly; the catalog
// hands this reader lazy accessors (see constructCatalog).
import {
  COUNTY_RISK_BBOX,
  COUNTY_RISK_CENTER,
  COUNTY_TIDE_MINOR_FT,
} from '../../data/countyRisk.js';

const EARTH_RADIUS_KM = 6371;

/** Great-circle distance in km between two lat/lon points. */
export function distanceKm(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(Math.min(1, a)));
}

function inCountyBbox(lat, lon) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= COUNTY_RISK_BBOX.latMin &&
    lat <= COUNTY_RISK_BBOX.latMax &&
    lon >= COUNTY_RISK_BBOX.lonMin &&
    lon <= COUNTY_RISK_BBOX.lonMax
  );
}

function nearCounty(lat, lon, km) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  return (
    distanceKm(lat, lon, COUNTY_RISK_CENTER.lat, COUNTY_RISK_CENTER.lon) <= km
  );
}

function safeRecords(layer) {
  try {
    const records = layer?.getAnalystRecords?.();
    return Array.isArray(records) ? records : [];
  } catch {
    return [];
  }
}

function safeStats(layer) {
  try {
    const stats = layer?.getStats?.();
    return stats && typeof stats === 'object' ? stats : null;
  } catch {
    return null;
  }
}

const num = (v) => (Number.isFinite(v) ? v : null);

/** Warning / watch / advisory from an NWS event name + severity. */
export function classifyNwsAlert(record) {
  const event = String(record?.event ?? '');
  const severity = String(record?.severity ?? '');
  if (/Warning/i.test(event) || severity === 'Extreme' || severity === 'Severe')
    return 'warning';
  if (/Watch/i.test(event)) return 'watch';
  if (/Advisory/i.test(event) || /Statement/i.test(event)) return 'advisory';
  return null;
}

function readWeather(layers) {
  const nwsRecords = safeRecords(layers.nwsAlertCard);
  const nwsStats = safeStats(layers.nwsAlertCard);
  const tideRecords = safeRecords(layers.tides);
  const tideStats = safeStats(layers.tides);
  const gaugeRecords = safeRecords(layers.gauges);
  const gaugeStats = safeStats(layers.gauges);

  let warnings = 0;
  let watches = 0;
  let advisories = 0;
  const topEvents = [];
  for (const record of nwsRecords) {
    const kind = classifyNwsAlert(record);
    if (kind === 'warning') warnings += 1;
    else if (kind === 'watch') watches += 1;
    else if (kind === 'advisory') advisories += 1;
    const event = String(record?.event ?? '').trim();
    if (event && topEvents.length < 3 && !topEvents.includes(event)) {
      topEvents.push(event);
    }
  }

  let tideFt = null;
  let tideStage = 'none';
  for (const record of tideRecords) {
    const level = num(record?.observedFtMllw);
    if (level === null) continue;
    if (tideFt === null || level > tideFt) tideFt = level;
    // The tides layer computes floodStage itself from its NWS thresholds;
    // this reader trusts that field and only falls back to the 6.2 ft
    // minor-flood line below when the stage is unavailable.
    const stage = String(record?.floodStage ?? '');
    if (['minor', 'moderate', 'major'].includes(stage)) {
      const rank = { minor: 1, moderate: 2, major: 3 };
      if (rank[stage] > (rank[tideStage] ?? 0)) tideStage = stage;
    }
  }
  // The 6.2 ft minor-flood line fires on the number itself when the
  // station's own stage is unavailable.
  if (
    tideStage === 'none' &&
    Number.isFinite(tideFt) &&
    tideFt >= COUNTY_TIDE_MINOR_FT
  ) {
    tideStage = 'minor';
  }

  const gauges = gaugeRecords
    .map((record) => ({
      site: String(record?.site ?? '').trim() || null,
      gageHeightFt: num(record?.gageHeightFt),
    }))
    .filter((g) => g.gageHeightFt !== null);

  const updatedAts = [num(nwsStats?.lastUpdate), num(tideStats?.lastUpdate)];
  const updatedAtMs =
    Math.max(...updatedAts.filter((v) => v !== null), 0) || null;
  const available =
    updatedAts.some((v) => v !== null) ||
    nwsRecords.length > 0 ||
    tideRecords.length > 0;
  return {
    available,
    updatedAtMs,
    warnings,
    watches,
    advisories,
    topEvents,
    tideFt,
    tideStage,
    // Gauges are context only in v1: neither USGS gauge has a published
    // NWS flood stage, so no threshold exists to score against. Shown on
    // the panel, never scored.
    gauges,
    inputs: {
      nws: nwsStats?.lastUpdate != null || nwsRecords.length > 0,
      tides: tideStats?.lastUpdate != null || tideRecords.length > 0,
      gauges: gaugeStats?.lastUpdate != null || gaugeRecords.length > 0,
    },
  };
}

function readPower(layers) {
  const stats = safeStats(layers.outages);
  const records = safeRecords(layers.outages);
  const customersOut = num(stats?.customersOut);
  const updatedAtMs = num(stats?.lastUpdate);
  return {
    available: updatedAtMs !== null || records.length > 0,
    updatedAtMs,
    customersOut,
    // The 1-hour-ago value comes from the source's own ring (the outages
    // layer keeps no history); the source fills this in.
    customersOut1hAgo: null,
    majorEvent: stats?.majorEvent === true,
  };
}

function readHazards(layers) {
  const gdacsRecords = safeRecords(layers.gdacs);
  const gdacsStats = safeStats(layers.gdacs);
  const quakeRecords = safeRecords(layers.earthquakes);
  const quakeStats = safeStats(layers.earthquakes);
  const fireRecords = safeRecords(layers.firms);

  let gdacsRed = 0;
  let gdacsOrange = 0;
  for (const record of gdacsRecords) {
    const level = String(record?.alertLevel ?? '');
    if (
      !inCountyBbox(record?.lat, record?.lon) &&
      !nearCounty(record?.lat, record?.lon, 100)
    )
      continue;
    if (level === 'Red') gdacsRed += 1;
    else if (level === 'Orange') gdacsOrange += 1;
  }

  let quakeMax = null;
  for (const record of quakeRecords) {
    const mag = num(record?.magnitude);
    if (mag === null) continue;
    const in100 = nearCounty(record?.lat, record?.lon, 100);
    const in200 = nearCounty(record?.lat, record?.lon, 200);
    if ((mag >= 4.0 && in100) || (mag >= 5.5 && in200)) {
      quakeMax = quakeMax === null ? mag : Math.max(quakeMax, mag);
    }
  }

  let fireCount = 0;
  let fireUpdatedAtMs = null;
  for (const record of fireRecords) {
    const acq = num(record?.acqTime);
    if (acq !== null && (fireUpdatedAtMs === null || acq > fireUpdatedAtMs)) {
      fireUpdatedAtMs = acq;
    }
    if (inCountyBbox(record?.lat, record?.lon)) fireCount += 1;
  }

  const updatedAts = [
    num(gdacsStats?.lastUpdate),
    num(quakeStats?.lastUpdate),
    fireUpdatedAtMs,
  ].filter((v) => v !== null);
  const updatedAtMs = updatedAts.length ? Math.max(...updatedAts) : null;
  const available =
    updatedAts.length > 0 ||
    gdacsRecords.length > 0 ||
    quakeRecords.length > 0 ||
    fireRecords.length > 0;
  return {
    available,
    updatedAtMs,
    gdacsRed,
    gdacsOrange,
    quakeMax,
    fireCount,
    inputs: {
      gdacs: gdacsStats?.lastUpdate != null || gdacsRecords.length > 0,
      earthquakes: quakeStats?.lastUpdate != null || quakeRecords.length > 0,
      firms: fireRecords.length > 0,
    },
  };
}

function readSpace(layers) {
  const stats = safeStats(layers.spaceWeather);
  const records = safeRecords(layers.spaceWeather);
  const first = records[0] ?? null;
  const kp = num(stats?.kp ?? first?.kp);
  const gScale =
    typeof stats?.gScale === 'string'
      ? stats.gScale
      : typeof first?.gScale === 'string'
        ? first.gScale
        : null;
  const updatedAtMs = num(stats?.lastUpdate);
  return {
    available: updatedAtMs !== null || records.length > 0,
    updatedAtMs,
    kp,
    gScale,
  };
}

/**
 * Map live layer modules to the normalized risk inputs.
 *
 * @param {object} layers - { nwsAlertCard, tides, gauges, outages,
 *   gdacs, earthquakes, firms, spaceWeather } — any entry may be null.
 * @param {number} [nowMs=Date.now()] - evaluation time.
 * @returns {object} inputs for scoreCountyRisk (lightning filled in by
 *   the source from /api/lightning/status).
 */
export function readCountyRiskInputs(layers = {}, nowMs = Date.now()) {
  return {
    nowMs,
    weather: readWeather(layers),
    power: readPower(layers),
    hazards: readHazards(layers),
    // Lightning has no layer module; the source fetches it from the
    // sidecar and replaces this placeholder.
    lightning: {
      available: false,
      updatedAtMs: null,
      flashes30m: null,
      flashes60m: null,
    },
    space: readSpace(layers),
  };
}
