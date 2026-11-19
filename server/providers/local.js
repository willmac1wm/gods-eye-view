import path from 'node:path';
import { openSkyProxy } from './aircraft/opensky.js';
import { celestrakProxy, rocketLaunchesProxy } from './space.js';
import { tomtomProxy } from './traffic.js';
import { firmsProxy } from './firms.js';
import { aprsProxy } from './aprs.js';
import { outagesProxy } from './outages.js';
import { fuelProxy } from './fuel.js';
import { disasterHistoryProxy } from './disasterHistory.js';
import { marineWarningsProxy } from './marineWarnings.js';
import { gdacsProxy } from './gdacs.js';
import { iodaProxy } from './ioda.js';
import { outbreaksProxy } from './outbreaks.js';
import { satnogsProxy } from './satnogs.js';
import { gpsjamDailyProxy } from './gpsjam.js';
import { vdl2DailyProxy } from './vdl2.js';
import { gaugesProxy } from './gauges.js';
import { faaStatusProxy } from './faaStatus.js';
import { terrainHeightsProxy } from './terrain.js';
import { adsbdbProxy } from './aircraft/enrichment.js';
import { overpassProxy } from './overpass.js';
import { militaryInstallationsProxy } from './military-installations.js';
import { regionalBriefProxy } from './regional/briefing.js';
import { geocodeProxy, NOMINATIM_CACHE_DIR } from './regional/place.js';
import { weatherEffectsProxy } from './regional/weather-effects.js';
import { cctvProxy } from './cctv.js';
import { defaultSourceRoot } from './common/source-root.js';
import { radioBrowserProxy } from './radio.js';
import { gbfsProxy } from './gbfs.js';
import { localReceiversProxy } from './local-receivers.js';
import { transitProxy } from './transit.js';
import { railProxy } from './rail.js';
import { adsbLolProxy } from './aircraft/adsb-lol.js';
import { aisLiveProxy } from './vessels/ais-live.js';
import { trackBackfillProxies } from './aircraft/tracks.js';
import { openAiRealtimeProxy } from './openai.js';
import { geminiLiveProxy } from './gemini.js';
import { googlePlacesContextProxy } from './places.js';
import { mapillaryProxy } from './mapillary.js';
import { keySetupEndpoint } from '../standalone/key-setup.js';
import { weatherProxy } from './weather.js';
import { firePerimetersProxy } from './firePerimeters.js';
import { gnssIntegrityProxy } from './gnssIntegrity.js';
import { ghostMapsProxy } from './ghostMaps.js';
import { shipwrecksProxy } from './shipwrecks.js';
import { droneAirspaceProxy } from './droneAirspace.js';
import { newsProxy } from './news.js';
import { inaturalistProxy } from './inaturalist/observations.js';
import { acartiaProxy } from './acartia.js';
import { cycloneProxy } from './cyclones.js';
import { windProxy } from './wind.js';
import { airNowProxy } from './airnow.js';
import { scannerProxy } from './scanner.js';
import { sarFloodProxy } from './sarFlood.js';
import { localAwarenessProxy } from './local/index.js';
import { capeProxy } from './local/capeProxy.js';
import { nwsProxy } from './nws.js';
import { spaceWeatherProxy } from './spaceWeather.js';
import { droughtProxy } from './drought.js';
import { copernicusProxy } from './copernicus.js';
import { radiationProxy } from './radiation.js';
import { sanctionsProxy } from './sanctions.js';
import { navareaProxy } from './navarea.js';
import { ndbcProxy } from './ndbc.js';
import { aviationWxProxy } from './aviationWx.js';
import { tfrsProxy } from './tfrs.js';
import { nwsWindProxy } from './nwsWind.js';
import { deldotProxy } from './deldot.js';
import { nj511Proxy } from './nj511.js';
import { windyProxy } from './windy.js';
import { firewireCadProxy } from './firewireCad.js';
import { firewireRadioProxy } from './firewireRadio.js';
import { floodTilesProxy } from './floodTiles.js';
import { capeDispatchProxy } from './cape.js';
import { sidecarProxy } from './sidecar.js';
import { opsCompileProxy, opsPagesPlugin } from './ops/index.js';
import { sigmetProxy } from './sigmet.js';
import { libraryProxy } from './library.js';
import { NEWS_API_PATHS } from '../../src/layers/news/source.js';

const NEWS_PREFIX = '/api/news';
/** The news layer's read routes, relative to the `/api/news` mount. */
const NEWS_LAYER_ROUTES = new Set(
  NEWS_API_PATHS.map((route) => route.slice(NEWS_PREFIX.length)),
);

/**
 * Two providers share `/api/news`: the news layer's proxy (hotspots, feed,
 * outline) and the Cape news sidecar (brief, status, review, latest...),
 * mounted after it. The news proxy answers every path it is given (400 for
 * one it does not know), so it is handed only its own routes; the rest pass
 * on to the sidecar. A request that is no URL stays with the news proxy,
 * which refuses it.
 */
function newsLayerRoutesOnly(plugin) {
  const narrow = (configure) =>
    configure &&
    ((server, ...rest) =>
      configure(
        Object.create(server, {
          middlewares: {
            value: {
              use(prefix, handler) {
                server.middlewares.use(prefix, (req, res, next) => {
                  let route = null;
                  try {
                    route = new URL(req.url || '/', 'http://local').pathname;
                  } catch {
                    return handler(req, res, next);
                  }
                  return NEWS_LAYER_ROUTES.has(route)
                    ? handler(req, res, next)
                    : next();
                });
              },
            },
          },
        }),
        ...rest,
      ));
  return {
    ...plugin,
    configureServer: narrow(plugin.configureServer),
    configurePreviewServer: narrow(plugin.configurePreviewServer),
  };
}

/**
 * Construct the local provider plugins in their established order.
 * `realtime` configures OpenAI; `gemini` explicitly opts into Gemini Live.
 * `nominatimStorageDir` binds an owned absolute directory before construction;
 * omission retains the durable per-source cache and policy state.
 */
function localProviderPlugins({
  realtime,
  gemini,
  nominatimStorageDir = NOMINATIM_CACHE_DIR,
} = {}) {
  if (
    typeof nominatimStorageDir !== 'string' ||
    !nominatimStorageDir.trim() ||
    !path.isAbsolute(nominatimStorageDir)
  )
    throw new TypeError('nominatimStorageDir must be an absolute directory');
  return [
    openSkyProxy(),
    celestrakProxy(),
    tomtomProxy(),
    firmsProxy(),
    aprsProxy(),
    outagesProxy(),
    fuelProxy(),
    disasterHistoryProxy(),
    marineWarningsProxy(),
    gdacsProxy(),
    iodaProxy(),
    outbreaksProxy(),
    satnogsProxy(),
    gpsjamDailyProxy(),
    vdl2DailyProxy(),
    gaugesProxy(),
    faaStatusProxy(),
    rocketLaunchesProxy(),
    terrainHeightsProxy(),
    adsbdbProxy(),
    overpassProxy(),
    militaryInstallationsProxy(),
    regionalBriefProxy(),
    geocodeProxy({ storageDir: nominatimStorageDir }),
    weatherEffectsProxy(),
    cctvProxy({ sourceRoot: defaultSourceRoot }),
    radioBrowserProxy(),
    gbfsProxy(),
    localReceiversProxy(),
    transitProxy(),
    railProxy(),
    adsbLolProxy(),
    aisLiveProxy(),
    trackBackfillProxies(),
    openAiRealtimeProxy({ realtime }),
    ...(gemini ? [geminiLiveProxy({ realtime: gemini })] : []),
    googlePlacesContextProxy(),
    windProxy(),
    airNowProxy(),
    scannerProxy(),
    sarFloodProxy(),
    localAwarenessProxy(),
    capeProxy(),
    weatherProxy(),
    cycloneProxy(),
    mapillaryProxy(),
    firePerimetersProxy(),
    gnssIntegrityProxy(),
    libraryProxy(),
    ghostMapsProxy(),
    shipwrecksProxy(),
    droneAirspaceProxy(),
    newsLayerRoutesOnly(newsProxy()),
    inaturalistProxy(),
    acartiaProxy(),
    nwsProxy(),
    spaceWeatherProxy(),
    droughtProxy(),
    copernicusProxy(),
    radiationProxy(),
    sanctionsProxy(),
    navareaProxy(),
    ndbcProxy(),
    aviationWxProxy(),
    tfrsProxy(),
    nwsWindProxy(),
    deldotProxy(),
    nj511Proxy(),
    windyProxy(),
    firewireCadProxy(),
    firewireRadioProxy(),
    floodTilesProxy(),
    capeDispatchProxy(),
    sidecarProxy(),
    opsCompileProxy(),
    opsPagesPlugin(),
    sigmetProxy(),
    keySetupEndpoint(),
  ];
}

export { localProviderPlugins };

export {
  CCTV_FRAME_FETCH_TIMEOUT_MS,
  fetchCctvImageFromUpstream,
} from './cctv.js';
export {
  createRadioProxyMiddleware,
  isPublicRadioAddress,
  normalizeRadioBrowserStation,
  publicRadioStation,
  publicRadioHttpsUrl,
} from './radio.js';
export { LL2_CACHE_TTL_MS, launchLibraryRequestHeaders } from './space.js';
export { googlePlacesContextProxy } from './places.js';
export { googleServerApiKey } from './places.js';
export { keylessGooglePlacesResponse } from './places.js';
export { keylessGoogleGeocodeResponse } from './places.js';
export { validateGeocodeAddress } from './places.js';
export { geocodeBounds } from './places.js';
export { adsbLolFallbackAnchor } from './aircraft/opensky.js';
export { readResponseTextCapped } from './common/http.js';
export { readResponseJsonCapped } from './common/http.js';
export { coalesceProxyRequest } from './common/http.js';
export { requiredFiniteQueryNumber } from './common/query.js';
export { isOverpassBoundaryQuery } from './overpass/query.js';
export { simplifyOverpassPayloadBody } from './overpass/geometry.js';
export { readOverpassDisk } from './overpass/cache.js';
export { resolveOverpassPreflight } from './overpass/cache.js';
export { overpassPayloadIsData } from './overpass/transport.js';
export { fetchOverpassPayload } from './overpass/transport.js';
export { openAiRealtimeProxy } from './openai.js';
export { MILITARY_INSTALLATION_ELEMENT_CAP } from './military-installations/constants.js';
export { quantizeMilitaryInstallationBox } from './military-installations/query.js';
export { militaryInstallationCacheKey } from './military-installations/query.js';
export { resolveMilitaryInstallationTier } from './military-installations/cache.js';
export { migrateMilitaryInstallationEntry } from './military-installations/cache.js';
export { militaryInstallationDiskFresh } from './military-installations/cache.js';
export { militaryInstallationDiskPath } from './military-installations/cache.js';
export { readMilitaryInstallationDisk } from './military-installations/cache.js';
export { writeMilitaryInstallationDisk } from './military-installations/cache.js';
export { validMilitaryInstallationBox } from './military-installations/query.js';
export { militaryInstallationFailureReason } from './military-installations/query.js';
export { validRegionalPoint } from './regional/query.js';
export { regionalBriefHasAnySource } from './regional/briefing.js';
