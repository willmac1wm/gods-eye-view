import { createSpaceWeatherSource } from '../layers/spaceWeather/index.js';
import { createApplicationSpaceWeather } from '../app/layers/spaceWeather.js';
export * from '../layers/spaceWeather/index.js';
/** Wire the standalone source and application overlay owner. */
export function createSpaceWeatherLayer({
  source = createSpaceWeatherSource(),
  ...options
} = {}) {
  return createApplicationSpaceWeather({ source, ...options });
}
