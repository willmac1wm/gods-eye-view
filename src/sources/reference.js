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
import { createGdacsSource } from '../layers/gdacs/source.js';
import { createInternetOutagesSource } from '../layers/internetOutages/source.js';
import { createHifldInstallationsSource } from '../layers/hifldInstallations/source.js';
import { createOutbreaksSource } from '../layers/outbreaks/source.js';
import { createFalloutPlumeSource } from '../layers/plume/source.js';
import { createCredibilitySource } from '../layers/credibility/source.js';
import { createHistorySource } from '../layers/historyReplay/source.js';
import { createSatnogsSource } from '../layers/satnogs/source.js';
import { createGpsjamSource } from '../layers/gpsjam/source.js';
import { createVdl2Source } from '../layers/vdl2/source.js';
import { createUsgsGaugesSource } from '../layers/gauges/source.js';
import { createSurveillanceSource } from '../layers/surveillance/source.js';
import { createDisasterHistorySource } from '../layers/disasterHistory/source.js';
import { createTrafficCamerasSource } from '../layers/trafficCameras/source.js';
import { createNwsAlertCardSource } from '../layers/nwsAlertCard/source.js';
import { createSpaceWeatherSource } from '../layers/spaceWeather/source.js';
import { createDroughtSource } from '../layers/drought/source.js';
import { createRadiationSource } from '../layers/radiation/source.js';
import { createSanctionsSource } from '../layers/sanctionsWatch/source.js';
import { createNavareaSource } from '../layers/navarea/source.js';
import { createPortsSource } from '../layers/ports/source.js';

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
    'gdacs-hazards': createGdacsSource(),
    'internet-outages': createInternetOutagesSource(),
    'hifld-installations': createHifldInstallationsSource(),
    outbreaks: createOutbreaksSource(),
    'fallout-plume': createFalloutPlumeSource(),
    'credibility-scoring': createCredibilitySource(),
    'history-replay': createHistorySource(),
    satnogs: createSatnogsSource(),
    'gpsjam-daily': createGpsjamSource(),
    vdl2: createVdl2Source(),
    'water-gauges': createUsgsGaugesSource(),
    'surveillance-cameras': createSurveillanceSource(),
    'disaster-history': createDisasterHistorySource(),
    'traffic-cameras': createTrafficCamerasSource(),
    'nws-alert-card': createNwsAlertCardSource(),
    'space-weather': createSpaceWeatherSource(),
    drought: createDroughtSource(),
    radiation: createRadiationSource(),
    'sanctions-watch': createSanctionsSource(),
    'navarea-warnings': createNavareaSource(),
    ports: createPortsSource(),
  };
}
