// src/layers/gdacs/records.js
// Pure record rules for GDACS multi-hazard events: normalize the raw RSS
// items the server provider extracts, sort by GDACS alert level, and filter
// by event type. No network, no Cesium, no clock. The alert level is
// GDACS's own severity — never re-scored here. Whole-payload rejection
// mirrors normalizeEarthquakeSnapshot: a malformed payload never partially
// overwrites good data.
import { GDACS_ALERT_RANK, GDACS_EVENT_TYPES } from './policy.js';

export function numValue(value) {
  if (value === null || value === '' || typeof value === 'boolean') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function textValue(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function dateValue(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function latLonValue(lat, lon) {
  const latitude = numValue(lat);
  const longitude = numValue(lon);
  if (latitude === null || longitude === null) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { lat: latitude, lon: longitude };
}

/** GDACS alert level, or null when the item carries an unknown level. */
export function normalizeAlertLevel(value) {
  const text = textValue(value);
  if (!text) return null;
  if (text === 'Green' || text === 'Orange' || text === 'Red') return text;
  return null;
}

/** GDACS event-type code, or null when unknown. */
export function normalizeEventType(value) {
  const text = textValue(value);
  if (!text) return null;
  return Object.hasOwn(GDACS_EVENT_TYPES, text) ? text : null;
}

/**
 * Normalize one raw GDACS RSS item (as extracted by server/providers/gdacs.js)
 * to a display row, or null when it is not a usable event. An event needs an
 * id, a known type, and a title. A missing position is kept (the list shows
 * it) but flagged `hasPosition: false` — the layer pins only positioned
 * events and never drops an event for lacking a pin.
 */
export function normalizeGdacsEvent(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const eventId = textValue(raw.eventId);
  const type = normalizeEventType(raw.eventType);
  const title = textValue(raw.title);
  if (!eventId || !type || !title) return null;
  const alertLevel = normalizeAlertLevel(raw.alertLevel);
  if (!alertLevel) return null;
  let position = latLonValue(raw.lat, raw.lon);
  if (!position && typeof raw.georssPoint === 'string') {
    // "lat lon" fallback when the geo:Point block is absent.
    const parts = raw.georssPoint.trim().split(/\s+/);
    if (parts.length >= 2) position = latLonValue(parts[0], parts[1]);
  }
  const severity =
    raw.severity && typeof raw.severity === 'object'
      ? {
          text: textValue(raw.severity.text),
          unit: textValue(raw.severity.unit),
          value: numValue(raw.severity.value),
        }
      : { text: textValue(raw.severity), unit: null, value: null };
  const population =
    raw.population && typeof raw.population === 'object'
      ? {
          text: textValue(raw.population.text),
          unit: textValue(raw.population.unit),
          value: numValue(raw.population.value),
        }
      : { text: textValue(raw.population), unit: null, value: null };
  return {
    id: `${type}${eventId}`,
    eventId,
    type,
    typeLabel: GDACS_EVENT_TYPES[type],
    alertLevel,
    alertRank: GDACS_ALERT_RANK[alertLevel],
    alertScore: numValue(raw.alertScore),
    title,
    description: textValue(raw.description),
    link: textValue(raw.link),
    country: textValue(raw.country),
    iso3: textValue(raw.iso3),
    lat: position?.lat ?? null,
    lon: position?.lon ?? null,
    hasPosition: position !== null,
    fromDate: dateValue(raw.fromDate),
    toDate: dateValue(raw.toDate),
    publishedAt: dateValue(raw.pubDate),
    severity,
    population,
    glide: textValue(raw.glide),
    isCurrent: raw.isCurrent === true || raw.isCurrent === 'true',
  };
}

/**
 * Validate a provider payload and normalize its events. Returns the
 * snapshot or null when malformed / empty. An empty events array is a
 * valid snapshot (a quiet feed), but only when the envelope is well-formed.
 */
export function normalizeGdacsSnapshot(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    return null;
  if (!Array.isArray(payload.events)) return null;
  if (typeof payload.fetchedAt !== 'number') return null;
  const events = [];
  for (const raw of payload.events) {
    const row = normalizeGdacsEvent(raw);
    if (row) events.push(row);
  }
  return {
    fetchedAt: payload.fetchedAt,
    stale: payload.stale === true,
    ttlMs:
      typeof payload.ttlMs === 'number' && payload.ttlMs > 0
        ? payload.ttlMs
        : null,
    count: events.length,
    events,
  };
}

/** Red first, then Orange, then Green; newest first within a level. */
export function sortGdacsEvents(events) {
  return [...events].sort((a, b) => {
    const rank = (b.alertRank ?? 0) - (a.alertRank ?? 0);
    if (rank !== 0) return rank;
    const aTime = a.publishedAt ? Date.parse(a.publishedAt) : 0;
    const bTime = b.publishedAt ? Date.parse(b.publishedAt) : 0;
    return bTime - aTime;
  });
}

/** Keep only the given event-type codes (empty list keeps everything). */
export function filterGdacsEvents(events, types = []) {
  if (!Array.isArray(types) || types.length === 0) return [...events];
  const wanted = new Set(types);
  return events.filter((event) => wanted.has(event.type));
}

/** Counts per event type, for the panel summary. */
export function countGdacsByType(events) {
  const counts = {};
  for (const event of events) {
    counts[event.type] = (counts[event.type] ?? 0) + 1;
  }
  return counts;
}

/** Counts per alert level, for the panel summary. */
export function countGdacsByAlertLevel(events) {
  const counts = { Green: 0, Orange: 0, Red: 0 };
  for (const event of events) {
    if (Object.hasOwn(counts, event.alertLevel)) counts[event.alertLevel] += 1;
  }
  return counts;
}
