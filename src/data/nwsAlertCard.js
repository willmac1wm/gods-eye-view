import { createNwsAlertCardSource } from '../layers/nwsAlertCard/index.js';
import { createApplicationNwsAlertCard } from '../app/layers/nwsAlertCard.js';
export * from '../layers/nwsAlertCard/index.js';
/** Wire the standalone source and application overlay owner. */
export function createNwsAlertCardLayer({
  source = createNwsAlertCardSource(),
  ...options
} = {}) {
  return createApplicationNwsAlertCard({ source, ...options });
}
