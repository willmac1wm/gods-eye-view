import { createUsgsEarthquakeSource } from '../layers/earthquakes/source.js';
import { createScannerCallsSource } from '../layers/scannerCalls/source.js';
import { createSarFloodSource } from '../layers/sarFlood/index.js';
import { createCombinedAirQualitySource } from '../layers/airQuality/source.js';
import { createWfigsPerimeterSource } from '../layers/perimeters/source.js';
import { createDroneAirspaceSource } from '../layers/droneAirspace/source.js';
import { createBundledCableSource } from '../layers/submarineCables/bundledSource.js';
import { createAdsbGnssSource } from '../layers/gnss/source.js';
import { createWildlifeSightingsSource } from '../layers/wildlifeSightings/source.js';

/** Construct the existing reference feeds independently of application setup. */
export function createReferenceSources() {
  return {
    earthquakes: createUsgsEarthquakeSource(),
    'scanner-calls': createScannerCallsSource(),
    'sar-flood': createSarFloodSource(),
    'air-quality': createCombinedAirQualitySource(),
    'fire-perimeters': createWfigsPerimeterSource(),
    'drone-airspace': createDroneAirspaceSource(),
    'wildlife-sightings': createWildlifeSightingsSource(),
    cables: createBundledCableSource(),
    'gnss-integrity': createAdsbGnssSource(),
  };
}
