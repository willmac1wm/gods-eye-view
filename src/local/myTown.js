/**
 * My Town / Near Me. The chosen place is stored on this device only
 * (localStorage) and never sent anywhere. "Near Me" uses the browser's
 * location permission once, when asked; if denied, the app keeps working
 * with a town picked from the list.
 */
import { CITY_POIS } from '../cityPois.js';
import { distanceKm } from './format.js';

const KEY = 'gev:my-town:v1';
const listeners = new Set();
let state = load();

function load() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (v && Number.isFinite(v.lat) && Number.isFinite(v.lon)) return v;
  } catch {
    /* storage unavailable */
  }
  return { name: null, lat: null, lon: null, radiusKm: 12, filterMap: false, source: null };
}

function save() {
  try {
    if (state.name) localStorage.setItem(KEY, JSON.stringify(state));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable: the choice lasts this session only */
  }
  for (const l of listeners) {
    try {
      l(state);
    } catch {
      /* a broken listener must not block others */
    }
  }
}

export function townChoices() {
  return Object.entries(CITY_POIS).map(([id, c]) => ({
    id,
    name: c.name,
    lat: c.pois[0].lat,
    lon: c.pois[0].lon,
  }));
}

export function getMyTown() {
  return state;
}

export function setMyTown(town, source = 'list') {
  state = { ...state, name: town.name, lat: town.lat, lon: town.lon, source };
  save();
}

export function setMyTownOptions(patch) {
  state = { ...state, ...patch };
  save();
}

export function clearMyTown() {
  state = { name: null, lat: null, lon: null, radiusKm: state.radiusKm, filterMap: false, source: null };
  save();
}

export function subscribeMyTown(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** True when the point should be shown under the current My Town filter. */
export function nearMyTown(lat, lon, { force = false } = {}) {
  if (!state.name || (!state.filterMap && !force)) return true;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return true;
  return distanceKm(state.lat, state.lon, lat, lon) <= state.radiusKm;
}

/**
 * Near Me: one geolocation request. Resolves the nearest listed town, or
 * rejects with a plain message if permission is denied or unavailable.
 */
export function locateNearMe() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('This browser cannot share location. Pick your town from the list instead.'));
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        const towns = townChoices()
          .map((t) => ({ ...t, km: distanceKm(latitude, longitude, t.lat, t.lon) }))
          .sort((a, b) => a.km - b.km);
        const nearest = towns[0];
        if (!nearest || nearest.km > 40)
          return reject(new Error('You appear to be outside Cape May County. Pick a town from the list instead.'));
        // Store the nearest town, not the precise position.
        resolve(nearest);
      },
      (err) =>
        reject(
          new Error(
            err.code === 1
              ? 'Location permission was denied. Pick your town from the list instead.'
              : 'Your location could not be found. Pick your town from the list instead.',
          ),
        ),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 },
    );
  });
}
