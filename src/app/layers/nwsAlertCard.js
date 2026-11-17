import { createNwsAlertCardLayer } from '../../layers/nwsAlertCard/index.js';
import { overlayHost } from './overlayHost.js';
/** Wire the plain-English NWS alert card to the application overlay host. */
export function createApplicationNwsAlertCard(options) {
  return createNwsAlertCardLayer({ overlayHost, ...options });
}
