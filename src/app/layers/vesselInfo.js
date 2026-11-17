import { createVesselInfoLayer } from '../../layers/vesselInfo/index.js';
import { createVesselInfoSource } from '../../layers/vesselInfo/source.js';
import { overlayHost } from './overlayHost.js';
/**
 * Wire vessel info to the application overlay host. The background
 * source is derived from the AIS vessels layer — there is no upstream
 * to fetch, so no catalog source is needed.
 */
export function createApplicationVesselInfo({
  vessels,
  source,
  ...options
} = {}) {
  return createVesselInfoLayer({
    source: source ?? createVesselInfoSource({ vessels }),
    overlayHost,
    ...options,
  });
}
