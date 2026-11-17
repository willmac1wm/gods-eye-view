import { createHistoryLayer } from '../../layers/historyReplay/index.js';
import { overlayHost } from './overlayHost.js';
/** Wire the history replay to the application overlay host. */
export function createApplicationHistory(options) {
  return createHistoryLayer({ overlayHost, ...options });
}
