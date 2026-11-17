import { createUsgsEarthquakeSource } from '../layers/earthquakes/source.js';
import { createSarFloodSource } from '../layers/sarFlood/source.js';
import { createCombinedAirQualitySource } from '../layers/airQuality/source.js';
import { createFaaNasSource } from '../layers/faaStatus/source.js';
import { createWfigsPerimeterSource } from '../layers/perimeters/source.js';
import { createDroneAirspaceSource } from '../layers/droneAirspace/source.js';
import { createBundledCableSource } from '../layers/submarineCables/bundledSource.js';
import { createAdsbGnssSource } from '../layers/gnss/source.js';
import { createWildlifeSightingsSource } from '../layers/wildlifeSightings/source.js';
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
import { createCountyRiskSource } from '../layers/countyRisk/source.js';
import { createDailyBriefSource } from '../layers/dailyBrief/source.js';
import { createReadinessSource } from '../layers/readiness/source.js';
import { createSatelliteVerificationSource } from '../layers/satelliteVerification/source.js';
import { createAlprAvoidanceSource } from '../layers/alprAvoidance/source.js';
import { createEmergencyCompositeSource } from '../layers/emergencyComposite/source.js';
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
    'sar-flood': createSarFloodSource(),
    'air-quality': createCombinedAirQualitySource(),
    'faa-status': createFaaNasSource(),
    'fire-perimeters': createWfigsPerimeterSource(),
    'drone-airspace': createDroneAirspaceSource(),
    'wildlife-sightings': createWildlifeSightingsSource(),
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
    // Standalone the risk source has no layer readers, so every input is
    // missing and the score is unavailable — the same degradation as the
    // wired catalog when no input layer has data yet.
    'county-risk': createCountyRiskSource(),
    'daily-brief': createDailyBriefSource(),
    // Standalone the readiness source has no layer readers, so every
    // driver is unavailable and every item falls back to the baseline —
    // the same degradation as the wired catalog with no live data yet.
    readiness: createReadinessSource(),
    // Standalone the satellite source still probes GIBS directly (keyless)
    // and reads the catalogue through the provider route; with no server
    // the catalogue is unavailable and the tile probe reports none.
    'satellite-verification': createSatelliteVerificationSource(),
    // Standalone there are no Directions endpoints to score, so the source
    // reports unavailable and the layer shows the placement guidance.
    'alpr-avoidance-routing': createAlprAvoidanceSource(),
    // Standalone there are no NWS/CAD/plume layer states to read and no
    // sidecar to fetch IPAWS from, so every quadrant is unavailable and
    // the panel says so — the same degradation as the wired catalog with
    // no live data yet.
    'emergency-composite': createEmergencyCompositeSource(),
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
