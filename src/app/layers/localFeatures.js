import { createLocalFeatureLayer } from '../../layers/localFeatures/index.js';
import { LOCAL_LAYER_DEFINITIONS } from '../../layers/localFeatures/definitions.js';
import { overlayHost } from './overlayHost.js';

/** The Cape May County / South Jersey local-awareness layers. */
export function createApplicationLocalLayers() {
  return LOCAL_LAYER_DEFINITIONS.map((definition) =>
    createLocalFeatureLayer({ overlayHost, ...definition }),
  );
}
