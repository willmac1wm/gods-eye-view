import { createCountyRiskLayer } from '../../layers/countyRisk/index.js';
import { overlayHost } from './overlayHost.js';
/** Wire the county risk score to the application overlay host. */
export function createApplicationCountyRisk(options) {
  return createCountyRiskLayer({ overlayHost, ...options });
}
