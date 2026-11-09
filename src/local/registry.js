/**
 * Map entity id -> details record, for the shared details window. Layers
 * register the records they draw; the window looks a picked entity up here,
 * so it never has to know any layer's internals.
 *
 * A details record:
 *   { title, subtitle?, kindLabel, status, source, sourceUrl?, observedAt?,
 *     fetchedAt?, fields: [[label, value], ...], description?, instruction?,
 *     transcript?, transcriptNote?, audioUrl?, imageUrl?, link?, lat?, lon?,
 *     note? }
 * Fields with no value are dropped by the window, never filled in.
 */
const records = new Map();
const listeners = new Set();

export const DETAILS_ID_PREFIX = 'gevd:';

export function detailsEntityId(layerId, featureId) {
  return `${DETAILS_ID_PREFIX}${layerId}:${featureId}`;
}

export function registerDetails(entityId, record) {
  records.set(entityId, record);
}

export function clearDetails(prefix) {
  for (const key of records.keys()) if (key.startsWith(prefix)) records.delete(key);
}

export function lookupDetails(entityId) {
  return records.get(entityId) || null;
}

/** Ask whatever details window is mounted to open a record. */
export function openDetails(record) {
  for (const l of listeners) l(record);
}

export function onOpenDetails(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
