import {
  createScannerCallsLayer,
  createScannerCallsSource,
} from '../../layers/scannerCalls/index.js';
import { overlayHost } from './overlayHost.js';
/** Police, fire and EMS scanner calls on the application overlay host. */
export function createApplicationScannerCalls(options) {
  return createScannerCallsLayer({ overlayHost, ...options });
}
/** Airport (ATC) radio traffic, kept apart from emergency calls. */
export function createApplicationAirportRadio(options) {
  return createScannerCallsLayer({
    overlayHost,
    id: 'airport-radio',
    name: 'Airport Radio (ATC)',
    icon: '🛫',
    sourceLabel: 'Fire Wire · Atlantic City airport',
    ...options,
  });
}
export { createScannerCallsSource };
