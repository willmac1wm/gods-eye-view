import { createUsgsEarthquakeSource } from '../layers/earthquakes/source.js';
import { createEcccAirQualitySource } from '../layers/airQuality/source.js';
import { createWfigsPerimeterSource } from '../layers/perimeters/source.js';
import { createDroneAirspaceSource } from '../layers/droneAirspace/source.js';
import { createBundledCableSource } from '../layers/submarineCables/bundledSource.js';
import { createAdsbGnssSource } from '../layers/gnss/source.js';
import { createCoopsTidesSource } from '../layers/tides/source.js';
import { createAprsWeatherSource } from '../layers/aprs/source.js';
import { createMarineWarningsSource } from '../layers/marineWarnings/source.js';

/** Construct the existing reference feeds independently of application setup. */
export function createReferenceSources() {
  return {
    earthquakes: createUsgsEarthquakeSource(),
    'air-quality': createEcccAirQualitySource(),
    'fire-perimeters': createWfigsPerimeterSource(),
    'drone-airspace': createDroneAirspaceSource(),
    cables: createBundledCableSource(),
    'gnss-integrity': createAdsbGnssSource(),
    tides: createCoopsTidesSource(),
    'aprs-weather': createAprsWeatherSource(),
    'marine-warnings': createMarineWarningsSource(),
  };
}
