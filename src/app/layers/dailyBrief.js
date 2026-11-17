import { createDailyBriefLayer } from '../../layers/dailyBrief/index.js';
import { overlayHost } from './overlayHost.js';
/** Wire the daily brief to the application overlay host. */
export function createApplicationDailyBrief(options) {
  return createDailyBriefLayer({ overlayHost, ...options });
}
