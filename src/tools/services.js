/**
 * The default services Core's tools read: the layers' portable source
 * factories and the application request services. `fetchImpl` must resolve
 * the sources' relative `/api/...` paths; in a browser the page's own fetch
 * does, and elsewhere a caller supplies a resolving fetch. `appUrl` is the
 * address the app is served from; `app.fetch` requests the app's own paths.
 * `panelKey`, when the panel is offered, is the key its page carries, which
 * the panel's requests must include.
 */

import {
  createAlprTileSource,
  createOverpassAlprSource,
} from '../layers/alpr/source.js';
import { GBFS_CITY_REGISTRY } from '../layers/bikeshare/registry.js';
import { createBikeshareSource } from '../layers/bikeshare/source.js';
import { createCctvSource } from '../layers/cctv/source.js';
import { createCycloneSource } from '../layers/cyclones/source.js';
import { createUsgsEarthquakeSource } from '../layers/earthquakes/source.js';
import { createFaaNasSource } from '../layers/faaStatus/source.js';
import { createCoopsTidesSource } from '../layers/tides/source.js';
import { createMassOutageSource } from '../layers/outages/source.js';
import { createEiaFuelSource } from '../layers/fuel/source.js';
import { createAprsWeatherSource } from '../layers/aprs/source.js';
import { createMarineWarningsSource } from '../layers/marineWarnings/source.js';
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
import { createFirmsSource } from '../layers/firms/source.js';
import { createInstallationSource } from '../layers/installations/source.js';
import { createLaunchSource } from '../layers/launches/source.js';
import { createWfigsPerimeterSource } from '../layers/perimeters/source.js';
import { createRadioSource } from '../layers/radio/source.js';
import { createBundledCableSource } from '../layers/submarineCables/bundledSource.js';
import { searchHls } from '../layers/recentImagery/catalog.js';
import { rankLatest, wvsSnapshotUrl } from '../layers/recentImagery/model.js';
import { createSatelliteSource } from '../layers/satellites/source.js';
import { createTrafficSource } from '../layers/traffic/source.js';
import { createTransitSource } from '../layers/transit/source.js';
import { createWeatherSource } from '../layers/weather/source.js';
import { createWindSource } from '../layers/wind/source.js';
import { createApplicationRequestServices } from '../services/requests.js';
import { createEventPackSource } from '../sources/eventPacks.js';
import { createInfrastructureSource } from '../sources/infrastructureData.js';
import {
  createMilitarySource,
  createVesselSource,
  createFlightSource,
} from '../sources/live/standalone.js';
import {
  createGeocodePlaceService,
  createPlaceSearchService,
  createRouteService,
} from './places.js';

/** Construct every service Core's tools read. */
export function createToolServices({ fetchImpl, appUrl, panelKey }) {
  if (typeof fetchImpl !== 'function')
    throw new TypeError('A fetch implementation is required');
  const requests = createApplicationRequestServices({ fetchImpl });
  return {
    app: { baseUrl: appUrl, fetch: fetchImpl, panelKey },
    earthquakes: createUsgsEarthquakeSource({ fetchImpl }),
    'faa-status': createFaaNasSource({ fetchImpl }),
    tides: createCoopsTidesSource({ fetchImpl }),
    outages: createMassOutageSource({ fetchImpl }),
    'fuel-prices': createEiaFuelSource({ fetchImpl }),
    'aprs-weather': createAprsWeatherSource({ fetchImpl }),
    'marine-warnings': createMarineWarningsSource({ fetchImpl }),
    satnogs: createSatnogsSource({ fetchImpl }),
    'gpsjam-daily': createGpsjamSource({ fetchImpl }),
    vdl2: createVdl2Source({ fetchImpl }),
    'water-gauges': createUsgsGaugesSource({ fetchImpl }),
    'surveillance-cameras': createSurveillanceSource({ fetchImpl }),
    'disaster-history': createDisasterHistorySource({ fetchImpl }),
    'traffic-cameras': createTrafficCamerasSource({ fetchImpl }),
    'nws-alert-card': createNwsAlertCardSource({ fetchImpl }),
    'space-weather': createSpaceWeatherSource({ fetchImpl }),
    drought: createDroughtSource({ fetchImpl }),
    radiation: createRadiationSource({ fetchImpl }),
    'sanctions-watch': createSanctionsSource({ fetchImpl }),
    'navarea-warnings': createNavareaSource({ fetchImpl }),
    ports: createPortsSource({ fetchImpl }),
    fires: createFirmsSource({ fetchImpl }),
    launches: createLaunchSource({ fetchImpl }),
    aircraft: createFlightSource({ fetchImpl }),
    military: createMilitarySource({ fetchImpl }),
    vessels: createVesselSource({
      fetchImpl,
      origin: () => new URL(appUrl).origin,
    }),
    satellites: createSatelliteSource({ fetchImpl }),
    cctv: createCctvSource({ fetchImpl }),
    radio: createRadioSource({ fetchImpl }),
    placeSearch: createPlaceSearchService({ fetchImpl }),
    routing: createRouteService({ fetchImpl }),
    bikeshare: {
      systems: GBFS_CITY_REGISTRY,
      getStations: createBikeshareSource({ fetchImpl }).getStations,
    },
    transit: createTransitSource({ fetchImpl }),
    traffic: createTrafficSource({ fetchImpl, tileFetchImpl: fetchImpl }),
    weather: requests.weather,
    weatherMaps: createWeatherSource({ fetchImpl }),
    wind: createWindSource({ fetchImpl }),
    imagery: createImageryService({ fetchImpl }),
    cables: createBundledCableSource({ fetchImpl }),
    alpr: createAlprTileSource({
      tileFetchImpl: fetchImpl,
      fallbackSource: createOverpassAlprSource({ fetchImpl }),
    }),
    infrastructure: createInfrastructureSource({ fetchImpl }),
    events: createEventPackSource({ fetchImpl }),
    regional: requests.regional,
    terrain: requests.terrain,
    summary: requests.summary,
    features: requests.features,
    cyclones: createCycloneSource({ fetchImpl }),
    perimeters: createWfigsPerimeterSource({ fetchImpl }),
    installations: createInstallationSource({
      fetchImpl,
      tileFetchImpl: fetchImpl,
    }),
    places: createGeocodePlaceService({ fetchImpl }),
  };
}

/** Recent keyless satellite imagery: the clearest recent day and its image. */
function createImageryService({ fetchImpl }) {
  return {
    async latest({ box, signal }) {
      const result = await searchHls({ box, fetchImpl, signal });
      return {
        ...rankLatest(result.candidates, { truncated: result.truncated }),
        errors: result.errors,
      };
    },
    async getSnapshot({ product, day, box, width, height, signal }) {
      const response = await fetchImpl(
        wvsSnapshotUrl({ product, day, box, width, height }),
        { signal },
      );
      if (!response.ok) throw new Error(`Imagery HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const type = response.headers.get('content-type') || '';
      return { contentType: type.split(';')[0].trim().toLowerCase(), bytes };
    },
  };
}
