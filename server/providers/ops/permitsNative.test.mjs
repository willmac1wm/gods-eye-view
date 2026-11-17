import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mapDcaPermitRow,
  resolveCapeComu,
  resolveModIvKeysFromPoint,
  CAPE_MAY_COMU,
} from './permitsNative.js';

test('resolveCapeComu maps Cape May municipalities and codes', () => {
  assert.equal(resolveCapeComu({ comu: '0502' }), '0502');
  assert.equal(resolveCapeComu({ municipality: 'Cape May City' }), '0502');
  assert.equal(resolveCapeComu({ municipality: 'Lower Township' }), '0505');
  assert.equal(resolveCapeComu({ municipality: 'Avalon Borough' }), '0501');
  assert.equal(resolveCapeComu({ municipality: 'Unknownville' }), null);
  assert.equal(CAPE_MAY_COMU.WILDWOOD, '0515');
});

test('mapDcaPermitRow builds Place case shape without owners', () => {
  const mapped = mapDcaPermitRow({
    comu: '0502',
    muniname: 'CAPE MAY',
    block: '13601',
    lot: '16',
    permitno: '21-80031',
    permittypedesc: 'Alteration',
    permitstatusdesc: 'Certificate',
    permitdate: '2021-03-02T00:00:00.000',
    constcost: '545',
    pk: '050200000008',
  });
  assert.equal(mapped.id, '050200000008');
  assert.equal(mapped.title, 'Alteration');
  assert.equal(mapped.type, 'permit');
  assert.equal(mapped.status, 'Certificate');
  assert.equal(mapped.opened_at, '2021-03-02');
  assert.match(mapped.address, /Block 13601/);
  assert.match(mapped.address, /Lot 16/);
  assert.equal(mapped.source, 'nj-dca-w9se-dmra');
  assert.equal(mapped.owner, undefined);
  assert.equal(mapped.ownerName, undefined);
});

test('mapDcaPermitRow ignores empty rows', () => {
  assert.equal(mapDcaPermitRow(null), null);
  assert.equal(mapDcaPermitRow({}), null);
});

test('resolveModIvKeysFromPoint maps cadastral attrs to block/lot/comu', async () => {
  const keys = await resolveModIvKeysFromPoint(38.935, -74.91, async () =>
    new Response(
      JSON.stringify({
        features: [
          {
            attributes: {
              PCLBLOCK: '13601',
              PCLLOT: '16',
              MUN_NAME: 'CAPE MAY CITY',
              COUNTY: 'CAPE MAY',
            },
          },
        ],
      }),
      { status: 200 },
    ),
  );
  assert.equal(keys.block, '13601');
  assert.equal(keys.lot, '16');
  assert.equal(keys.comu, '0502');
});

test('resolveModIvKeysFromPoint returns null on miss', async () => {
  const keys = await resolveModIvKeysFromPoint(38.9, -74.9, async () =>
    new Response(JSON.stringify({ features: [] }), { status: 200 }),
  );
  assert.equal(keys, null);
});
