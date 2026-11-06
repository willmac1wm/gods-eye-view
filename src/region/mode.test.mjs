import assert from 'node:assert/strict';
import test from 'node:test';
import * as Cesium from 'cesium';
import {
  CAPE_BBOX,
  CAPE_OVERVIEW,
  REGIONAL_CCTV_MAX_SOURCES,
  cctvAllowlist,
  cctvPackEnabled,
  effectiveCctvMaxSources,
  firmsArea,
  isCapeRegion,
  regionalMissionLayerIds,
  regionalSystemAllowed,
  spaceMissionsSatelliteCatalog,
  usgsEarthquakeFeedUrl,
} from './mode.js';
import { cctvLivePackStates } from '../../server/providers/cctv/catalog.js';
import { resolveCatalogCap } from '../../server/providers/cctv/cap.js';
import { DEFAULT_CCTV_MAX_SOURCES } from '../../server/providers/cctv/constants.js';
import { flyToGlobeView, GLOBE_VIEW } from '../locations.js';
import { realtimeDirectives } from '../../server/providers/openai/instructions.js';
import { runFirstRunChoice } from '../firstRunExperience.js';
import { createPolicyHelpers } from '../layers/launches/policyHelpers.js';
import { transitFeedsInRange } from '../data/transitFeeds.js';

const CAPE = { GEV_REGION: 'cape' };
const enabled = (env) =>
  new Set(
    cctvLivePackStates(env)
      .filter((pack) => pack.enabled)
      .map((pack) => pack.name),
  );

function stubViewer() {
  const flights = [];
  return {
    flights,
    camera: {
      positionCartographic: {
        longitude: Cesium.Math.toRadians(-97.74),
        latitude: Cesium.Math.toRadians(30.27),
        height: 1200,
      },
      cancelFlight() {},
      flyTo(options) {
        flights.push(options);
      },
    },
  };
}

test('unset region keeps world CCTV defaults, including Austin and Caltrans kill switches', () => {
  assert.equal(isCapeRegion({}), false);
  assert.equal(cctvAllowlist({}), null);
  const on = enabled({});
  assert.equal(on.has('austin'), true);
  assert.equal(on.has('caltrans'), true);
  assert.equal(on.has('fintraffic'), true);
  assert.equal(on.has('hk'), true);
  assert.equal(on.has('txdot'), true);
  assert.equal(on.has('deldot'), true);
  assert.equal(on.has('faa-weathercams'), true);
  assert.equal(on.has('nyc'), false, 'opt-in packs stay off');
  assert.equal(
    cctvPackEnabled('austin', 'CCTV_AUSTIN_ENABLED', {}, { CCTV_AUSTIN_ENABLED: '0' }),
    false,
  );
  assert.equal(
    cctvPackEnabled('caltrans', 'CCTV_CALTRANS_ENABLED', {}, {
      CCTV_CALTRANS_ENABLED: '0',
    }),
    false,
  );
  assert.equal(effectiveCctvMaxSources({}), undefined);
  assert.equal(resolveCatalogCap(effectiveCctvMaxSources({})), DEFAULT_CCTV_MAX_SOURCES);
  assert.equal(firmsArea({}), 'world');
  assert.match(
    usgsEarthquakeFeedUrl({}),
    /summary\/all_day\.geojson$/,
  );
});

test('GEV_REGION=cape enables DelDOT and FAA WeatherCams and drops far packs', () => {
  const on = enabled(CAPE);
  assert.deepEqual([...on].sort(), ['deldot', 'faa-weathercams']);
  for (const far of [
    'austin',
    'caltrans',
    'fintraffic',
    'txdot',
    'hk',
    'wsdot',
    'toronto',
    'vegvesen',
    'tfl',
    'drivebc',
  ]) {
    assert.equal(on.has(far), false, far);
  }
  assert.equal(
    cctvPackEnabled('fintraffic', 'CCTV_FINTRAFFIC_ENABLED', {}, {
      ...CAPE,
      CCTV_FINTRAFFIC_ENABLED: '1',
    }),
    true,
    'explicit opt-in still adds one pack',
  );
  assert.equal(
    cctvPackEnabled('deldot', 'CCTV_DELDOT_ENABLED', {}, {
      ...CAPE,
      CCTV_DELDOT_ENABLED: '0',
    }),
    false,
  );
  assert.equal(
    resolveCatalogCap(effectiveCctvMaxSources(CAPE)),
    REGIONAL_CCTV_MAX_SOURCES,
  );
  assert.equal(
    resolveCatalogCap(effectiveCctvMaxSources({ ...CAPE, CCTV_MAX_SOURCES: '40' })),
    40,
  );
  assert.deepEqual(cctvAllowlist({ CCTV_REGION_PACKS: 'deldot' }), ['deldot']);
  assert.deepEqual(
    [...enabled({ GEV_REGION: 'cape', CCTV_REGION_PACKS: 'deldot' })],
    ['deldot'],
  );
});

test('cape globe reset frames the mid-Atlantic overview, not the planet', () => {
  assert.deepEqual(CAPE_BBOX, {
    west: -80.6,
    south: 38.3,
    east: -71.8,
    north: 45.1,
  });
  assert.equal(CAPE_OVERVIEW.longitude, -76.2);
  assert.equal(CAPE_OVERVIEW.latitude, 41.7);
  assert.ok(CAPE_OVERVIEW.heightM > 500_000);
  assert.ok(CAPE_OVERVIEW.heightM < 2_000_000);
  assert.ok(GLOBE_VIEW.heightM > 12_000_000);
  const regional = stubViewer();
  const target = flyToGlobeView(regional, { env: CAPE });
  assert.equal(target.heightM, CAPE_OVERVIEW.heightM);
  assert.equal(target.latitude, CAPE_OVERVIEW.latitude);
  assert.equal(target.longitude, CAPE_OVERVIEW.longitude);
  const destination = regional.flights[0].destination;
  const carto = Cesium.Cartographic.fromCartesian(destination);
  assert.ok(Math.abs(carto.height - CAPE_OVERVIEW.heightM) < 1);
  assert.equal(regional.flights[0].endTransform, Cesium.Matrix4.IDENTITY);

  const world = stubViewer();
  const globe = flyToGlobeView(world, { env: {} });
  assert.equal(globe.heightM, GLOBE_VIEW.heightM);
});

test('cape voice, first-run, transit, and satellites stay regional', () => {
  const capeLines = realtimeDirectives(undefined, { env: CAPE });
  const capeText = capeLines.join('\n');
  assert.match(capeText, /mid-Atlantic overview/);
  assert.doesNotMatch(capeText, /tri-state/);
  assert.match(capeText, /do not enable local-firms/);
  assert.doesNotMatch(capeText, /local-firms and earthquakes plus zoom_to_globe/);

  const worldText = realtimeDirectives(undefined, { env: {} }).join('\n');
  assert.match(worldText, /local-firms and earthquakes plus zoom_to_globe/);
  assert.match(worldText, /can never reach the globe/);

  assert.deepEqual(
    regionalMissionLayerIds(['earthquakes', 'local-firms'], CAPE),
    ['earthquakes'],
  );
  assert.deepEqual(
    regionalMissionLayerIds(['earthquakes', 'local-firms'], {}),
    ['earthquakes', 'local-firms'],
  );

  const helpers = createPolicyHelpers({
    state: {},
    services: {},
    parts: {},
    source: {},
  });
  assert.equal(
    helpers.satelliteParamsForSpaceMissions({ catalog: 'core' }, CAPE).catalog,
    'core',
  );
  assert.equal(
    helpers.satelliteParamsForSpaceMissions({ catalog: 'core' }, {}).catalog,
    'dense',
  );
  assert.equal(spaceMissionsSatelliteCatalog(CAPE), 'core');

  assert.equal(regionalSystemAllowed(60.17, 24.94, CAPE), false);
  assert.equal(regionalSystemAllowed(39.08, -74.82, CAPE), true);
  assert.equal(regionalSystemAllowed(40.44, -79.99, CAPE), true);
  assert.equal(regionalSystemAllowed(45.01, -73.35, CAPE), true);
  assert.equal(regionalSystemAllowed(41.07, -71.86, CAPE), true);
  assert.equal(regionalSystemAllowed(42.36, -71.06, CAPE), false);
  assert.equal(regionalSystemAllowed(41.5, -81.7, CAPE), false);
  assert.equal(regionalSystemAllowed(60.17, 24.94, {}), true);
  assert.deepEqual(transitFeedsInRange(42.37, -71.11, 0, CAPE), []);
  assert.ok(transitFeedsInRange(42.37, -71.11, 0, {}).some((feed) => feed.id === 'mbta'));

  assert.equal(
    firmsArea(CAPE),
    `${CAPE_BBOX.west},${CAPE_BBOX.south},${CAPE_BBOX.east},${CAPE_BBOX.north}`,
  );
  const quakes = new URL(usgsEarthquakeFeedUrl(CAPE, Date.UTC(2026, 10, 4)));
  assert.equal(quakes.searchParams.get('maxlatitude'), String(CAPE_BBOX.north));
  assert.equal(quakes.searchParams.get('minlatitude'), String(CAPE_BBOX.south));
  assert.equal(quakes.searchParams.get('minlongitude'), String(CAPE_BBOX.west));
  assert.equal(quakes.searchParams.get('maxlongitude'), String(CAPE_BBOX.east));
  assert.equal(quakes.searchParams.get('minmagnitude'), '2.5');
});

test('first-run environmental tile skips world FIRMS in cape mode', async () => {
  const calls = [];
  const outcome = await runFirstRunChoice(
    'environmental',
    {
      setContextMode: async () => ({ ok: true }),
      setLayerEnabled: async (layerId) => {
        calls.push(layerId);
        return true;
      },
      flyToGlobe: async () => ({ ok: true }),
    },
    CAPE,
  );
  assert.equal(outcome.ok, true);
  assert.deepEqual(calls, ['earthquakes']);
});
