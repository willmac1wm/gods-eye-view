/**
 * Apply Managers `globe.layers` Cape toggles onto the Cesium data manager.
 * Share URL `v=2&l=` wins: when shareOwnsLayers is true, this is a no-op.
 * Only `cape-*` ids are touched so world layers stay under share/local state.
 */

/**
 * @param {object} options
 * @param {{ setEnabled?: (id: string, on: boolean) => unknown, layers?: Map<string, unknown> }} options.dataManager
 * @param {Record<string, boolean>|null|undefined} options.layers
 * @param {boolean} [options.shareOwnsLayers]
 * @returns {string[]} layer ids that were applied
 */
export function applyCapeManagerLayers({
  dataManager,
  layers,
  shareOwnsLayers = false,
} = {}) {
  if (shareOwnsLayers) return [];
  if (!dataManager || typeof dataManager.setEnabled !== 'function') return [];
  if (!layers || typeof layers !== 'object') return [];
  const applied = [];
  for (const [id, on] of Object.entries(layers)) {
    if (!id.startsWith('cape-')) continue;
    if (typeof on !== 'boolean') continue;
    if (dataManager.layers instanceof Map && !dataManager.layers.has(id))
      continue;
    try {
      dataManager.setEnabled(id, on);
      applied.push(id);
    } catch {
      /* layer may not be registered yet */
    }
  }
  return applied;
}

/**
 * Soft-fetch manager config and apply cape-* layer prefs.
 * @param {object} options
 * @param {object} options.dataManager
 * @param {boolean} [options.shareOwnsLayers]
 * @param {typeof fetch} [options.fetchImpl]
 */
export async function fetchAndApplyCapeManagerLayers({
  dataManager,
  shareOwnsLayers = false,
  fetchImpl = globalThis.fetch.bind(globalThis),
} = {}) {
  if (shareOwnsLayers || !dataManager) return [];
  try {
    const response = await fetchImpl('/api/ops/manager/config');
    if (!response.ok) return [];
    const body = await response.json();
    const config = body?.config || body;
    return applyCapeManagerLayers({
      dataManager,
      layers: config?.globe?.layers,
      shareOwnsLayers: false,
    });
  } catch {
    return [];
  }
}
