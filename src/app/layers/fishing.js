import { createFishingLayer } from '../../layers/fishing/index.js';
import { createFishingSource } from '../../layers/fishing/source.js';
import { overlayHost } from './overlayHost.js';
/**
 * Wire fishing activity to the application overlay host. The presence
 * source is derived from the AIS vessels layer — there is no upstream
 * to fetch, so no catalog source is needed.
 */
export function createApplicationFishing({ vessels, source, ...options } = {}) {
  return createFishingLayer({
    source: source ?? createFishingSource({ vessels }),
    overlayHost,
    ...options,
  });
}
