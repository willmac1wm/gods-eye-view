import assert from 'node:assert/strict';
import test from 'node:test';
import { createAlprAvoidanceSource } from './source.js';

const A = { lat: 39.0, lon: -74.6 };
const B = { lat: 39.1, lon: -74.5 };

// Two alternatives: the fast one passes a camera, the slow one does not.
function alternativesPayload() {
  return {
    ok: true,
    profile: 'car',
    alternatives: [
      {
        ok: true,
        profile: 'car',
        distanceM: 8500,
        durationS: 900,
        geometry: [
          [-74.6, 39.0],
          [-74.55, 39.0],
          [-74.5, 39.0],
        ],
      },
      {
        ok: true,
        profile: 'car',
        distanceM: 9200,
        durationS: 1200,
        geometry: [
          [-74.6, 39.1],
          [-74.55, 39.1],
          [-74.5, 39.1],
        ],
      },
    ],
  };
}

function harness({ cameras, alprStats, fetchImpl, endpoints } = {}) {
  const calls = [];
  const source = createAlprAvoidanceSource({
    readLayers: () => ({
      directions: {
        getEndpoints: () => endpoints ?? { a: A, b: B, mode: 'car' },
      },
      alpr: {
        getAnalystRecords: () => cameras ?? [{ id: 'alpr:1', lat: 39.0, lon: -74.55 }],
        getStats: () => alprStats ?? { stale: false, saturated: false },
      },
    }),
    fetchImpl:
      fetchImpl ??
      (async (url) => {
        calls.push(url);
        return Response.json(alternativesPayload());
      }),
  });
  return { source, calls };
}

test('alternatives are scored against the ALPR locations; fastest and lowest differ', async () => {
  const { source, calls } = harness();
  const snapshot = await source.getSnapshot();
  assert.equal(snapshot.available, true);
  assert.equal(snapshot.routes.length, 2);
  assert.equal(snapshot.routes[0].cameraCount, 1);
  assert.equal(snapshot.routes[1].cameraCount, 0);
  assert.equal(snapshot.fastestIndex, 0);
  assert.equal(snapshot.lowestIndex, 1);
  assert.equal(snapshot.sameRoute, false);
  assert.equal(snapshot.camerasConsidered, 1);
  assert.equal(snapshot.alprAvailable, true);
  assert.equal(snapshot.alprStale, false);
  assert.match(calls[0], /alternatives=1/);
  assert.match(calls[0], /profile=car/);
});

test('the same endpoints re-score in memory without a second fetch', async () => {
  const { source, calls } = harness();
  await source.getSnapshot();
  assert.equal(calls.length, 1);
  // A second tick with the same A/B re-scores the cached routes.
  await source.getSnapshot();
  assert.equal(calls.length, 1);
  // Forcing a refresh fetches again.
  await source.getSnapshot({ force: true });
  assert.equal(calls.length, 2);
});

test('no endpoints returns the unavailable snapshot without fetching', async () => {
  const { source, calls } = harness({ endpoints: { a: null, b: null, mode: 'car' } });
  const snapshot = await source.getSnapshot();
  assert.equal(snapshot.available, false);
  assert.equal(snapshot.reason, 'no-endpoints');
  assert.deepEqual(snapshot.routes, []);
  assert.equal(calls.length, 0);
});

test('an empty ALPR record list means exposure unknown, not zero cameras', async () => {
  const { source } = harness({ cameras: [] });
  const snapshot = await source.getSnapshot();
  assert.equal(snapshot.available, true);
  assert.equal(snapshot.alprAvailable, false);
  assert.equal(snapshot.camerasConsidered, 0);
  // The routes still show — the fastest is the only ranking that stands.
  assert.equal(snapshot.routes.length, 2);
  assert.equal(snapshot.routes[0].cameraCount, 0);
});

test('a single-route payload (no alternatives key) scores as one route', async () => {
  const { source } = harness({
    fetchImpl: async () =>
      Response.json({
        ok: true,
        profile: 'car',
        distanceM: 8500,
        durationS: 900,
        geometry: [
          [-74.6, 39.0],
          [-74.55, 39.0],
          [-74.5, 39.0],
        ],
      }),
  });
  const snapshot = await source.getSnapshot();
  assert.equal(snapshot.routes.length, 1);
  assert.equal(snapshot.sameRoute, true);
});

test('stale and saturated ALPR stats ride through to the snapshot', async () => {
  const { source } = harness({
    alprStats: { stale: true, saturated: true },
  });
  const snapshot = await source.getSnapshot();
  assert.equal(snapshot.alprStale, true);
  assert.equal(snapshot.alprSaturated, true);
});

test('a 429 from the proxy throws with the refusal attached', async () => {
  const { source } = harness({
    fetchImpl: async () =>
      new Response(JSON.stringify({ error: 'routing busy' }), { status: 429 }),
  });
  await assert.rejects(() => source.getSnapshot(), (error) => {
    assert.equal(error.status, 429);
    assert.match(error.message, /routing busy/);
    return true;
  });
});
