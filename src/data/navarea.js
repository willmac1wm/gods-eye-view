import { createNavareaSource } from '../layers/navarea/index.js';
import { createApplicationNavarea } from '../app/layers/navarea.js';
export * from '../layers/navarea/index.js';
/** Wire the standalone source and application overlay owner. */
export function createNavareaLayer({
  source = createNavareaSource(),
  ...options
} = {}) {
  return createApplicationNavarea({ source, ...options });
}
