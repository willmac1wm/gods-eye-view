import { createPortsSource } from '../layers/ports/index.js';
import { createApplicationPorts } from '../app/layers/ports.js';
export * from '../layers/ports/index.js';
/** Wire the standalone snapshot source and application overlay owner. */
export function createPortsLayer({
  source = createPortsSource(),
  ...options
} = {}) {
  return createApplicationPorts({ source, ...options });
}
