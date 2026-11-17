import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildTeresaHeadline,
  createIncidentHandler,
  isIncidentPublicSafe,
  stripUnitNumber,
} from './incidentPages.js';
import { BROWSER_CSP } from '../../../build/vite.js';

function makeRes() {
  return {
    status: 0,
    headers: {},
    body: '',
    writableEnded: false,
    writeHead(status, headers = {}) {
      this.status = status;
      this.headers = { ...this.headers, ...headers };
    },
    end(chunk = '') {
      this.body = String(chunk || '');
      this.writableEnded = true;
    },
  };
}

test('Teresa-style headline, unit stripping, and fail-closed safety filter match legacy incident_share rules', () => {
  assert.equal(stripUnitNumber('3400 Pacific Ave Apt 4B'), '3400 Pacific Ave');
  assert.equal(stripUnitNumber('102 Ocean Ave #12'), '102 Ocean Ave');

  const headline = buildTeresaHeadline({
    units: ['STA 51', 'ENG 51'],
    town: 'Wildwood',
    location: '3400 Pacific Ave Apt 2',
    title: 'Structure Fire',
  });
  assert.equal(
    headline,
    'STA 51 ENG 51 WILDWOOD -- 3400 PACIFIC AVE -- STRUCTURE FIRE',
  );

  assert.equal(isIncidentPublicSafe({ title: 'Structure Fire', summary: 'Smoke showing' }), true);
  assert.equal(isIncidentPublicSafe({ title: 'Domestic Dispute', summary: 'Report at residence' }), false);
  assert.equal(isIncidentPublicSafe({ title: 'EMS Call', summary: 'Possible suicide attempt' }), false);
  assert.equal(isIncidentPublicSafe({ title: 'Police Call', summary: 'Juvenile complaint' }), false);
});

test('/incidents/{id}, /incident/{id} redirect, and /incidents/{id}/card.svg serve public calls & approved reports and 404 private/sensitive ones', async () => {
  const tmpReportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gev-incidents-'));
  try {
    // Write one approved report and one pending report
    fs.writeFileSync(
      path.join(tmpReportDir, '1730000001-aa11bb22.json'),
      JSON.stringify({
        id: '1730000001-aa11bb22',
        createdAt: '2026-11-09T20:00:00Z',
        category: 'flooding',
        text: 'Water over Rio Grande Ave near Park Blvd',
        town: 'Wildwood',
        lat: 38.991,
        lon: -74.814,
        status: 'approved',
        visibility: 'public',
        verified: true,
      }),
    );
    fs.writeFileSync(
      path.join(tmpReportDir, '1730000002-cc33dd44.json'),
      JSON.stringify({
        id: '1730000002-cc33dd44',
        createdAt: '2026-11-09T20:05:00Z',
        category: 'other',
        text: 'Unreviewed private report',
        town: 'Cape May',
        lat: 38.935,
        lon: -74.906,
        status: 'pending-review',
        visibility: 'private',
      }),
    );

    const localSources = {
      'public-safety-calls': {
        async get() {
          return {
            source: { name: 'Fire Wire scanner transcription' },
            features: [
              {
                id: 'call:4091',
                title: 'Brush Fire',
                municipality: 'Middle Twp',
                location: '200 Route 47 Apt 3',
                summary: 'Units responding to brush fire along highway shoulder.',
                units: ['STA 71', 'TANKER 71'],
                audio: '/api/cape/fw-audio/call-4091.mp3',
                observedAt: '2026-11-09T21:15:00Z',
                geometry: { type: 'Point', lat: 39.08, lon: -74.82 },
              },
              {
                id: 'call:4092',
                title: 'Domestic Dispute',
                municipality: 'Lower Twp',
                location: '100 Bayshore Rd',
                summary: 'Sensitive domestic call',
                units: ['PD'],
                observedAt: '2026-11-09T21:20:00Z',
                geometry: { type: 'Point', lat: 38.98, lon: -74.95 },
              },
            ],
          };
        },
      },
    };

    const handle = createIncidentHandler({
      localSources,
      reportDir: tmpReportDir,
    });

    // 1. Legacy singular /incident/4091 redirects 302 -> /incidents/4091
    const redirRes = makeRes();
    assert.equal(await handle({ method: 'GET', url: '/incident/4091' }, redirRes), true);
    assert.equal(redirRes.status, 302);
    assert.equal(redirRes.headers.Location, '/incidents/4091');

    // 2. Public call /incidents/4091 renders 200 HTML with OG tags, stripped unit number, and 3D map link
    const callRes = makeRes();
    assert.equal(await handle({ method: 'GET', url: '/incidents/4091' }, callRes), true);
    assert.equal(callRes.status, 200);
    assert.equal(callRes.headers['Content-Security-Policy'], BROWSER_CSP);
    assert.ok(callRes.body.includes('STA 71 TANKER 71 MIDDLE TWP -- 200 ROUTE 47 -- BRUSH FIRE'));
    assert.ok(!callRes.body.includes('Apt 3'));
    assert.ok(callRes.body.includes('property="og:title"'));
    assert.ok(callRes.body.includes('property="og:image" content="https://capemaydispatch.com/incidents/4091/card.svg"'));
    assert.ok(callRes.body.includes('/?lat=39.08&amp;lon=-74.82&amp;incident=4091'));
    assert.ok(callRes.body.includes('src="/cape-incident.js"'));

    // 3. Social card SVG /incidents/4091/card.svg returns 200 image/svg+xml
    const svgRes = makeRes();
    assert.equal(await handle({ method: 'GET', url: '/incidents/4091/card.svg' }, svgRes), true);
    assert.equal(svgRes.status, 200);
    assert.equal(svgRes.headers['Content-Type'], 'image/svg+xml; charset=utf-8');
    assert.ok(svgRes.body.includes('CAPE MAY DISPATCH'));

    // 4. Sensitive call /incidents/4092 fails closed with 404
    const sensRes = makeRes();
    assert.equal(await handle({ method: 'GET', url: '/incidents/4092' }, sensRes), true);
    assert.equal(sensRes.status, 404);

    // 5. Approved community report /incidents/report:1730000001-aa11bb22 returns 200
    const repRes = makeRes();
    assert.equal(
      await handle({ method: 'GET', url: '/incidents/report:1730000001-aa11bb22' }, repRes),
      true,
    );
    assert.equal(repRes.status, 200);
    assert.ok(repRes.body.includes('Water over Rio Grande Ave near Park Blvd'));

    // 6. Unreviewed private report /incidents/report:1730000002-cc33dd44 fails closed with 404
    const privRes = makeRes();
    assert.equal(
      await handle({ method: 'GET', url: '/incidents/report:1730000002-cc33dd44' }, privRes),
      true,
    );
    assert.equal(privRes.status, 404);
  } finally {
    fs.rmSync(tmpReportDir, { recursive: true, force: true });
  }
});
