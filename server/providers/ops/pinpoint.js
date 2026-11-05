import { createHydrantsHandler } from './hydrants.js';
import { requiredFiniteQueryNumber } from '../common/query.js';
import { makeRateLimiter, clientKey } from '../common/rate-limit.js';

/**
 * AI pinpoint hydrant assist — v1 uses geometry nearest + optional text hint
 * (color / municipality). Full vision model lands when Fire Wire exposes stills.
 */
export function createHydrantPinpointHandler(options = {}) {
  // Reuse the hydrants handler's upstream by calling the public API shape.
  const hydrants = createHydrantsHandler(options);
  const allow = makeRateLimiter({ windowMs: 60_000, max: 40, globalMax: 400 });

  function json(res, status, body) {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(body));
  }

  return async function pinpointHandler(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.statusCode = 405;
      res.setHeader('Allow', 'GET, HEAD');
      return res.end();
    }
    if (!allow(clientKey(req))) return json(res, 429, { error: 'rate_limited' });
    const url = new URL(req.url || '/', 'http://local');
    const lat = requiredFiniteQueryNumber(url.searchParams, 'lat');
    const lon = requiredFiniteQueryNumber(url.searchParams, 'lon');
    if (lat == null || lon == null) {
      return json(res, 400, { error: 'lat_lon_required' });
    }
    const hint = String(url.searchParams.get('hint') || '')
      .trim()
      .toLowerCase();

    // Drive the hydrants handler with a synthetic req for a tight radius.
    let captured = null;
    const fakeRes = {
      statusCode: 200,
      setHeader() {},
      end(chunk) {
        try {
          captured = JSON.parse(String(chunk || '{}'));
        } catch {
          captured = null;
        }
      },
    };
    await hydrants(
      {
        method: 'GET',
        url: `/?lat=${lat}&lon=${lon}&radius_m=250&limit=20`,
        headers: req.headers,
        socket: req.socket,
      },
      fakeRes,
    );
    if (!captured?.hydrants) {
      return json(res, fakeRes.statusCode || 502, {
        error: 'pinpoint_unavailable',
        detail: captured?.error || 'no hydrant catalog',
      });
    }

    let candidates = captured.hydrants;
    if (hint) {
      const scored = candidates
        .map((h) => {
          const bag = `${h.color || ''} ${h.municipality || ''} ${h.type || ''} ${h.number || ''}`.toLowerCase();
          const hit = hint
            .split(/\s+/)
            .filter(Boolean)
            .every((token) => bag.includes(token));
          return { h, hit };
        })
        .filter((row) => row.hit)
        .map((row) => row.h);
      if (scored.length) candidates = scored;
    }

    const pick = candidates[0] || null;
    return json(res, 200, {
      lat,
      lon,
      hint: hint || null,
      method: hint ? 'nearest+hint' : 'nearest',
      confidence: pick
        ? pick.distanceM != null && pick.distanceM <= 40
          ? 0.86
          : pick.distanceM != null && pick.distanceM <= 120
            ? 0.64
            : 0.42
        : 0,
      pinpoint: pick,
      candidates: candidates.slice(0, 5),
      note: 'Geometry nearest from Cape May County catalog. Vision pinpoint waits on Fire Wire stills.',
      source: 'ops-pinpoint-v1',
    });
  };
}
