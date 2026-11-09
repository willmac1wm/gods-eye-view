import { createScannerCallsLayer } from '../../layers/scannerCalls/index.js';
import { overlayHost } from './overlayHost.js';
/** Wire scanner calls to the application overlay host. */
export function createApplicationScannerCalls(options) {
  return createScannerCallsLayer({ overlayHost, ...options });
}
