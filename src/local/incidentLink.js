import { finiteNumber, isNullIsland } from '../share/cameraParams.js';

/** Eye height for an incident deep link. */
export const INCIDENT_FLY_HEIGHT_M = 3500;

/**
 * Camera target for `?lat=&lon=` incident links.
 * Missing, non-numeric, out-of-range, and null-island coordinates fly nowhere.
 * @param {string} search `location.search`, with or without the leading `?`.
 * @returns {{lat: number, lon: number, height: number}|null}
 */
export function incidentFlyTarget(search) {
  const params = new URLSearchParams(
    typeof search === 'string' ? search : '',
  );
  if (!params.has('lat') || !params.has('lon')) return null;
  const lat = finiteNumber(params.get('lat'));
  const lon = finiteNumber(params.get('lon'));
  if (lat == null || lon == null) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  if (isNullIsland(lat, lon)) return null;
  return { lat, lon, height: INCIDENT_FLY_HEIGHT_M };
}
