import { createUsgsEarthquakeSource } from '../layers/earthquakes/source.js';
import { createFaaNasSource } from '../layers/faaStatus/source.js';
import { createEcccAirQualitySource } from '../layers/airQuality/source.js';
import { createWfigsPerimeterSource } from '../layers/perimeters/source.js';
import { createDroneAirspaceSource } from '../layers/droneAirspace/source.js';
import { createBundledCableSource } from '../layers/submarineCables/bundledSource.js';
import { createAdsbGnssSource } from '../layers/gnss/source.js';
import { createCoopsTidesSource } from '../layers/tides/source.js';
import { createMassOutageSource } from '../layers/outages/source.js';
import { createEiaFuelSource } from '../layers/fuel/source.js';
import { createAprsWeatherSource } from '../layers/aprs/source.js';
import { createMarineWarningsSource } from '../layers/marineWarnings/source.js';
import { createSatnogsSource } from '../layers/satnogs/source.js';
import { createGpsjamSource } from '../layers/gpsjam/source.js';
import { createVdl2Source } from '../layers/vdl2/source.js';
import { createUsgsGaugesSource } from '../layers/gauges/source.js';

/** Construct the existing reference feeds independently of application setup. */
export function createReferenceSources() {
  return {
    earthquakes: createUsgsEarthquakeSource(),
    'faa-status': createFaaNasSource(),
    'air-quality': createEcccAirQualitySource(),
    'fire-perimeters': createWfigsPerimeterSource(),
    'drone-airspace': createDroneAirspaceSource(),
    cables: createBundledCableSource(),
    'gnss-integrity': createAdsbGnssSource(),
    tides: createCoopsTidesSource(),
    outages: createMassOutageSource(),
    'fuel-prices': createEiaFuelSource(),
    'aprs-weather': createAprsWeatherSource(),
    'marine-warnings': createMarineWarningsSource(),
    satnogs: createSatnogsSource(),
    'gpsjam-daily': createGpsjamSource(),
    vdl2: createVdl2Source(),
    'water-gauges': createUsgsGaugesSource(),
  };
}
