import { createVesselInfoSource } from '../layers/vesselInfo/index.js';
import { createApplicationVesselInfo } from '../app/layers/vesselInfo.js';
export * from '../layers/vesselInfo/index.js';
/** Wire the background source (derived from the AIS vessels layer) and overlay owner. */
export function createVesselInfoLayer({
  vessels,
  source = createVesselInfoSource({ vessels }),
  ...options
} = {}) {
  return createApplicationVesselInfo({ source, ...options });
}
