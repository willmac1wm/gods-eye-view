import { resolveCatalogSources } from './sourceComposition.js';
import { createWeatherClock } from '../layers/weather/clock.js';
import { worldClock } from '../time/worldClock.js';
import { createWeatherLayer } from '../layers/weather/index.js';
import { createApplicationCyclones } from './layers/cyclones.js';
import { createSigmetLayer } from '../data/sigmet.js';
import { createCapeLayers } from '../layers/capeDispatch/layers.js';
import { createWindLayer } from '../layers/wind/index.js';
import { createLayerCatalog } from './catalog.js';
import { LAYER_STATE_REGISTRY } from '../data/layerState.js';
import { createMilitaryRegistry } from '../layers/aircraft/classification.js';
import { createApplicationFlights } from './layers/flights.js';
import { createApplicationMilitary } from './layers/militaryFlights.js';
import { createApplicationVessels } from './layers/aisLiveVessels.js';
import { createApplicationCctv } from './layers/cctv.js';
import { createApplicationRadio } from './layers/radio.js';
import { createApplicationTraffic } from './layers/traffic.js';
import { createApplicationBikeshare } from './layers/bikeshare.js';
import { createApplicationDirections } from './layers/directions.js';
import { createApplicationRecentImagery } from './layers/recentImagery.js';
import { createApplicationOsmPlaces } from './layers/osmPlaces.js';
import { createApplicationTransit } from './layers/transit.js';
import { createApplicationInstallations } from './layers/militaryInstallations.js';
import { createApplicationSatellites } from './layers/satellites.js';
import { createApplicationLaunches } from './layers/rocketLaunches.js';
import { createApplicationAlpr } from './layers/alprCameras.js';
import { createApplicationLocalAdsb } from './layers/localAdsb.js';
import { createApplicationAwareness } from './layers/militaryAwareness.js';
import { createApplicationFirms } from './layers/firms.js';
import { createApplicationEarthquakes } from './layers/earthquakes.js';
import { createApplicationSarFlood } from './layers/sarFlood.js';
import { createApplicationLocalLayers } from './layers/localFeatures.js';
import { createApplicationFaaStatus } from './layers/faaStatus.js';
import { createApplicationTides } from './layers/tides.js';
import { createApplicationOutages } from './layers/outages.js';
import { createApplicationFuel } from './layers/fuel.js';
import { createApplicationAprs } from './layers/aprs.js';
import { createApplicationMarineWarnings } from './layers/marineWarnings.js';
import { createApplicationGdacs } from './layers/gdacs.js';
import { createApplicationInternetOutages } from './layers/internet-outages.js';
import { createApplicationHifld } from './layers/hifld.js';
import { createApplicationOutbreaks } from './layers/outbreaks.js';
import { createApplicationPlume } from './layers/plume.js';
import { createApplicationCredibility } from './layers/credibility.js';
import { createApplicationCountyRisk } from './layers/countyRisk.js';
import { createCountyRiskSource } from '../layers/countyRisk/source.js';
import { createApplicationDailyBrief } from './layers/dailyBrief.js';
import { createDailyBriefSource } from '../layers/dailyBrief/source.js';
import { createApplicationReadiness } from './layers/readiness.js';
import { createReadinessSource } from '../layers/readiness/source.js';
import { createApplicationSatelliteVerification } from './layers/satelliteVerification.js';
import { createBrowserBlackTile } from '../layers/satelliteVerification/blackTile.js';
import { createSatelliteVerificationSource } from '../layers/satelliteVerification/source.js';
import { createApplicationAlprAvoidance } from './layers/alprAvoidance.js';
import { createAlprAvoidanceSource } from '../layers/alprAvoidance/source.js';
import { createApplicationEmergencyComposite } from './layers/emergencyComposite.js';
import { createEmergencyCompositeSource } from '../layers/emergencyComposite/source.js';
import { createApplicationAiSituation } from './layers/aiSituation.js';
import { createAiSituationSource } from '../layers/aiSituation/source.js';
import { createApplicationHistory } from './layers/historyReplay.js';
import { createApplicationSatnogs } from './layers/satnogs.js';
import { createApplicationGpsjam } from './layers/gpsjam.js';
import { createApplicationVdl2 } from './layers/vdl2.js';
import { createApplicationGauges } from './layers/gauges.js';
import { createApplicationSurveillance } from './layers/surveillance.js';
import { createApplicationDisasterHistory } from './layers/disasterHistory.js';
import { createApplicationTrafficCameras } from './layers/trafficCameras.js';
import { createApplicationNwsAlertCard } from './layers/nwsAlertCard.js';
import { createApplicationSpaceWeather } from './layers/spaceWeather.js';
import { createApplicationDrought } from './layers/drought.js';
import { createApplicationRadiation } from './layers/radiation.js';
import { createApplicationSanctionsWatch } from './layers/sanctionsWatch.js';
import { createApplicationFishing } from './layers/fishing.js';
import { createApplicationVesselInfo } from './layers/vesselInfo.js';
import { createApplicationNavarea } from './layers/navarea.js';
import { createApplicationPorts } from './layers/ports.js';
import { createApplicationAirQuality } from './layers/airQuality.js';
import { createApplicationFirePerimeters } from './layers/perimeters.js';
import { createApplicationGnssIntegrity } from './layers/gnss.js';
import { createApplicationGhostMaps } from './layers/ghostMaps.js';
import { createApplicationDroneAirspace } from './layers/droneAirspace.js';
import { createApplicationWildlifeSightings } from './layers/wildlifeSightings.js';
import { createApplicationCables } from './layers/submarineCables.js';
import { createOsmOverlayLayers } from '../data/osmOverlays.js';
import { createApplicationStreetLevel } from './layers/streetLevel.js';
import { createInfrastructureLayers } from '../data/infrastructure.js';
import { localGeoJsonServices } from './localGeojsonServices.js';
import { createBhoteKoshiEventLayer } from '../data/bhoteKoshiEvent.js';
import { createBhoteKoshiLocatorLayer } from '../data/bhoteKoshiLocator.js';

/**
 * Hardware-local layers are registered like any other but never enter share
 * links or stored layer state: another browser cannot have this receiver.
 */
export const LOCAL_ONLY_LAYER_METADATA = Object.freeze([
  Object.freeze({ id: 'local-adsb', disposition: 'local-only' }),
  // Voice search results belong to this session, like a receiver to this machine.
  Object.freeze({ id: 'osm-places', disposition: 'local-only' }),
]);

/** Serialization metadata for every layer the application catalog constructs. */
export const APPLICATION_LAYER_METADATA = Object.freeze([
  ...LAYER_STATE_REGISTRY,
  ...LOCAL_ONLY_LAYER_METADATA,
]);

/** Construct the current catalog without choosing any source provider.
 * Scene engines remain page-owned; layers and classification have this app's lifetime.
 * The manager owns layer destruction, while abort releases classification even if startup fails.
 */
export function createApplicationCatalog({
  surface,
  sources,
  signal,
  metadata = APPLICATION_LAYER_METADATA,
  vesselOptions,
  resolveAsset,
  nepalBoundaryResolver,
  streetLevelProviders,
}) {
  if (!signal?.addEventListener)
    throw new TypeError('An application lifetime signal is required');
  signal.throwIfAborted();
  if (!surface?.groundFloor || !surface?.terrain)
    throw new TypeError('Application surface services are required');

  const sourceComposition = resolveCatalogSources(sources);
  sources = sourceComposition.sources;
  const militaryRegistry = createMilitaryRegistry();
  const weatherClock = createWeatherClock({ world: worldClock });
  const dispose = () => {
    signal.removeEventListener('abort', dispose);
    militaryRegistry.dispose();
    weatherClock.destroy();
  };
  signal.addEventListener('abort', dispose, { once: true });
  try {
    if (sourceComposition.isConfigured('military'))
      militaryRegistry.configureSource(sources.military, { signal });
    const flights = createApplicationFlights({
      surface,
      source: sources.flights,
      militaryRegistry,
      resolveAsset,
    });
    const military = createApplicationMilitary({
      surface,
      source: sources.military,
      militaryRegistry,
      resolveAsset,
    });
    const vessels = createApplicationVessels({
      source: sources.vessels,
      options: vesselOptions,
    });
    const installations = createApplicationInstallations({
      surface,
      source: sources.installations,
    });
    const satellites = createApplicationSatellites({
      source: sources.satellites,
    });
    // D4 inputs, hoisted so the county risk score can read them through
    // lazy accessors (the localAdsb precedent: no layer reads another
    // layer directly, and no layer is constructed twice).
    const earthquakes = createApplicationEarthquakes({
      source: sources.earthquakes,
    });
    const tides = createApplicationTides({ source: sources.tides });
    const outages = createApplicationOutages({ source: sources.outages });
    const gdacs = createApplicationGdacs({ source: sources['gdacs-hazards'] });
    const gauges = createApplicationGauges({ source: sources['water-gauges'] });
    const nwsAlertCard = createApplicationNwsAlertCard({
      source: sources['nws-alert-card'],
    });
    const spaceWeather = createApplicationSpaceWeather({
      source: sources['space-weather'],
    });
    const drought = createApplicationDrought({
      source: sources['drought'],
    });
    const firms = createApplicationFirms({
      surface,
      id: 'local-firms',
      name: 'FIRMS Active Fires',
      icon: '▲',
      source: 'NASA FIRMS · LIVE',
      feed: sources.firms,
    });
    // D8 inputs, hoisted like the D4 drivers so the avoidance layer can read
    // the Directions endpoints and the ALPR camera locations through lazy
    // accessors (the localAdsb precedent: no layer reads another layer
    // directly, and no layer is constructed twice).
    const alpr = createApplicationAlpr({ surface, source: sources.alpr });
    const directions = createApplicationDirections({
      source: sources.directions,
    });
    // D9 inputs, hoisted like the D4 drivers and the D8 inputs so the
    // emergency composite can read the NWS, CAD and plume states through
    // lazy accessors (the localAdsb precedent: no layer reads another
    // layer directly, and no layer is constructed twice). The plume is
    // hoisted out of the catalog array below; the cape layers are
    // constructed once here and the CAD feed picked out by id.
    const plume = createApplicationPlume({ source: sources['fallout-plume'] });
    const capeLayers = createCapeLayers();
    const capeCad = capeLayers.find((layer) => layer.id === 'cape-cad');
    // D4: the risk score reads the input layers above (never the other
    // way round) plus the sidecar lightning status; it is constructed
    // after every input so the lazy readers are never null.
    const countyRisk = createApplicationCountyRisk({
      source: createCountyRiskSource({
        readLayers: () => ({
          nwsAlertCard,
          tides,
          gauges,
          outages,
          gdacs,
          earthquakes,
          firms,
          spaceWeather,
        }),
      }),
    });
    // D5: the brief is written in the sidecar (the blog writer over the
    // last 24 h of stored items + alerts); the layer only pins the latest
    // post from /api/news/brief.
    const dailyBrief = createApplicationDailyBrief({
      source: createDailyBriefSource(),
    });
    // D6: the checklists are static (bundled checklists.json); the source
    // reads the driver layers above and marks items "due now" when their
    // driver is active. Constructed after every driver, like countyRisk.
    const readiness = createApplicationReadiness({
      source: createReadinessSource({
        readLayers: () => ({
          nwsAlertCard,
          tides,
          outages,
          drought,
          spaceWeather,
        }),
      }),
    });
    // D7: GIBS true-color tiles are fetched by the browser (keyless,
    // CORS-open); the Sentinel-2 catalogue comes from the server's
    // Copernicus provider (/api/satellite-verification). Constructed last
    // — it drapes over the county rectangle and lists the newest products.
    const satelliteVerification = createApplicationSatelliteVerification({
      source: createSatelliteVerificationSource({
        isBlackTile: createBrowserBlackTile(),
      }),
    });
    // D8: the avoidance layer scores route alternatives for the Directions
    // endpoints against the ALPR layer's mapped camera locations. Constructed
    // after both inputs so the lazy readers are never null.
    const alprAvoidance = createApplicationAlprAvoidance({
      source: createAlprAvoidanceSource({
        readLayers: () => ({ directions, alpr }),
      }),
    });
    // D9: the emergency composite reads the NWS, CAD and plume states plus
    // the newest IPAWS-sourced alerts from the sidecar (/api/alerts/ipaws).
    // Constructed after all three inputs so the lazy readers are never null.
    const emergencyComposite = createApplicationEmergencyComposite({
      source: createEmergencyCompositeSource({
        readLayers: () => ({ nwsAlertCard, capeCad, plume }),
      }),
    });
    // D1: the AI situation reads predictions + AI status from the
    // sidecar (/api/predictions, /api/ai/status) and asks questions
    // at /api/qa. Constructed last — it depends on the data layers.
    const aiSituation = createApplicationAiSituation({
      source: createAiSituationSource(),
    });
    const catalog = createLayerCatalog(
      [
        createBhoteKoshiEventLayer(),
        createBhoteKoshiLocatorLayer({
          boundaryResolver: nepalBoundaryResolver,
        }),
        flights,
        military,
        createApplicationLocalAdsb({
          surface,
          enrichment: sources.flights,
          displayParams: () => flights.getParams(),
          ...(resolveAsset ? { resolveAsset } : {}),
        }),
        earthquakes,
        ...createApplicationLocalLayers(),
        createApplicationSarFlood({ source: sources['sar-flood'] }),
        createApplicationFaaStatus({ source: sources['faa-status'] }),
        tides,
        outages,
        createApplicationFuel({ source: sources['fuel-prices'] }),
        createApplicationAprs({ source: sources['aprs-weather'] }),
        createApplicationMarineWarnings({ source: sources['marine-warnings'] }),
        gdacs,
        createApplicationInternetOutages({
          source: sources['internet-outages'],
        }),
        createApplicationHifld({
          source: sources['hifld-installations'],
        }),
        createApplicationOutbreaks({ source: sources.outbreaks }),
        plume,
        createApplicationCredibility({
          source: sources['credibility-scoring'],
        }),
        createApplicationHistory({ source: sources['history-replay'] }),
        createApplicationSatnogs({ source: sources.satnogs }),
        createApplicationGpsjam({ source: sources['gpsjam-daily'] }),
        createApplicationVdl2({ source: sources.vdl2 }),
        gauges,
        createApplicationSurveillance({
          source: sources['surveillance-cameras'],
        }),
        createApplicationDisasterHistory({
          source: sources['disaster-history'],
        }),
        createApplicationTrafficCameras({
          source: sources['traffic-cameras'],
        }),
        nwsAlertCard,
        spaceWeather,
        drought,
        createApplicationRadiation({
          source: sources['radiation'],
        }),
        createApplicationSanctionsWatch({
          source: sources['sanctions-watch'],
          vessels,
        }),
        createApplicationFishing({ vessels }),
        createApplicationVesselInfo({ vessels }),
        createApplicationNavarea({
          source: sources['navarea-warnings'],
        }),
        createApplicationPorts({ source: sources['ports'] }),
        createApplicationAirQuality({ source: sources['air-quality'] }),
        createApplicationFirePerimeters({
          source: sources['fire-perimeters'],
        }),
        createApplicationGnssIntegrity({
          source: sources['gnss-integrity'],
          windowMs: sources['gnss-integrity'].windowMs,
        }),
        createApplicationGhostMaps({ source: sources['s2-ghostmaps'] }),
        createApplicationDroneAirspace({
          source: sources['drone-airspace'],
        }),
        createApplicationWildlifeSightings({
          source: sources['wildlife-sightings'],
          groundFloor: surface.groundFloor,
        }),
        alpr,
        createApplicationStreetLevel({
          surface,
          sources: { mapillary: sources.mapillary },
          providers: streetLevelProviders,
        }),
        satellites,
        createApplicationLaunches({ source: sources.launches, satellites }),
        createApplicationTraffic({ source: sources.traffic, surface }),
        createApplicationCctv({ surface, source: sources.cctv }),
        createApplicationRadio({ surface, source: sources.radio }),
        createApplicationTransit({ surface, source: sources.transit }),
        createApplicationBikeshare({ source: sources.bikeshare }),
        directions,
        createApplicationRecentImagery({ source: sources['recent-imagery'] }),
        createApplicationOsmPlaces(),
        vessels,
        installations,
        createApplicationAwareness({
          flights,
          military,
          vessels,
          installations,
        }),
        createWindLayer({ feed: sources.wind, clock: weatherClock }),
        createWeatherLayer({
          feed: sources.weather,
          id: 'weather-radar',
          clock: weatherClock,
        }),
        createWeatherLayer({
          feed: sources.weather,
          id: 'weather-satellite',
          clock: weatherClock,
        }),
        createWeatherLayer({
          feed: sources.weather,
          id: 'weather-lightning',
          clock: weatherClock,
        }),
        createApplicationCyclones({ feed: sources.cyclones }),
        createSigmetLayer(),
        ...capeLayers,
        ...createOsmOverlayLayers(),
        ...createInfrastructureLayers(localGeoJsonServices),
        createApplicationCables({ source: sources.cables }),
        firms,
        countyRisk,
        dailyBrief,
        readiness,
        satelliteVerification,
        alprAvoidance,
        emergencyComposite,
        aiSituation,
      ],
      metadata,
    );
    return Object.freeze({
      ...catalog,
      getSourceAvailability: sourceComposition.createAvailabilityLookup(
        catalog.layers,
      ),
      militaryRegistry,
      surface,
      weatherClock,
    });
  } catch (error) {
    dispose();
    throw error;
  }
}
