import assert from 'node:assert/strict';
import test from 'node:test';
import { createPlaceHandler } from './place.js';

function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(k, v) {
      this.headers[k] = v;
    },
    end(chunk) {
      this.body = chunk ?? '';
    },
  };
}

test('place redacts owner and maps MOD-IV occupancy', async () => {
  const handler = createPlaceHandler({
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          features: [
            {
              attributes: {
                PROP_LOC: '123 BEACH AVE',
                PROP_CLASS: '4A',
                BLDG_DESC: 'STORE',
                YR_CONSTR: 1962,
                LAND_DESC: 'COMM',
                MUN_NAME: 'CAPE MAY CITY',
                COUNTY: 'CAPE MAY',
                CALC_ACRE: 0.12,
                NET_VALUE: 450000,
                DWELL: 0,
                COMM_DWELL: 2,
                BLDG_CLASS: 'C',
                PROP_USE: 'STORE',
                PAMS_PIN: '0502_1_1',
                PCLBLOCK: '1',
                PCLLOT: '1',
                OWNER_NAME: 'SHOULD NOT APPEAR',
              },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
  });
  const res = mockRes();
  await handler(
    { method: 'GET', url: '/?lat=38.935&lon=-74.923', headers: {} },
    res,
  );
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.found, true);
  assert.equal(body.occupancy.label, 'Commercial');
  assert.equal(body.parcel.address, '123 BEACH AVE');
  assert.equal(body.privacy.ownerName, 'redacted');
  assert.ok(!JSON.stringify(body).includes('SHOULD NOT APPEAR'));
});
