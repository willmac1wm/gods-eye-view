import { createDisasterHistorySource } from '../layers/disasterHistory/index.js';
import { createApplicationDisasterHistory } from '../app/layers/disasterHistory.js';
export * from '../layers/disasterHistory/index.js';
/** Wire the standalone source and application overlay owner. */
export function createDisasterHistoryLayer({
  source = createDisasterHistorySource(),
  ...options
} = {}) {
  return createApplicationDisasterHistory({ source, ...options });
}
