import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseVisibility,
  ceilingFeet,
  classifyFlightCategory,
  categoryColor,
  mapMetarRow,
  mapTafRows,
} from './aviationWx.js';

test('parseVisibility handles numbers, plus-suffixed and fractional strings', () => {
  assert.equal(parseVisibility(10), 10);
  assert.equal(parseVisibility('10+'), 10);
  assert.equal(parseVisibility('1/2'), 0.5);
  assert.equal(parseVisibility('1 1/4'), 1.25);
  assert.equal(parseVisibility('3'), 3);
  assert.equal(parseVisibility(null), null);
  assert.equal(parseVisibility('M1/4'), null);
});

test('ceilingFeet takes the lowest BKN/OVC/OVX layer only', () => {
  assert.equal(
    ceilingFeet([
      { cover: 'FEW', base: 800 },
      { cover: 'SCT', base: 1500 },
      { cover: 'BKN', base: 2500 },
      { cover: 'OVC', base: 4000 },
    ]),
    2500,
  );
  assert.equal(ceilingFeet([{ cover: 'FEW', base: 800 }]), null);
  assert.equal(ceilingFeet([{ cover: 'OVX', base: 300 }]), 300);
  assert.equal(ceilingFeet([]), null);
  assert.equal(ceilingFeet(null), null);
});

test('classifyFlightCategory prefers the API value, then FAA thresholds', () => {
  assert.equal(classifyFlightCategory('MVFR', 250, 0.5), 'MVFR');
  assert.equal(classifyFlightCategory(null, 400, 10), 'LIFR');
  assert.equal(classifyFlightCategory(null, 5000, 0.75), 'LIFR');
  assert.equal(classifyFlightCategory(null, 900, 10), 'IFR');
  assert.equal(classifyFlightCategory(null, 5000, 2), 'IFR');
  assert.equal(classifyFlightCategory(null, 2500, 10), 'MVFR');
  assert.equal(classifyFlightCategory(null, 5000, 5), 'MVFR');
  assert.equal(classifyFlightCategory(null, 5000, 6), 'VFR');
  assert.equal(classifyFlightCategory(null, null, null), null);
  // One side missing still classifies from the other side.
  assert.equal(classifyFlightCategory(null, null, 0.5), 'LIFR');
  assert.equal(classifyFlightCategory(null, 400, null), 'LIFR');
});

test('categoryColor matches the old app palette', () => {
  assert.equal(categoryColor('VFR'), '#22c55e');
  assert.equal(categoryColor('MVFR'), '#3b82f6');
  assert.equal(categoryColor('IFR'), '#ef4444');
  assert.equal(categoryColor('LIFR'), '#e879f9');
  assert.equal(categoryColor(null), '#94a3b8');
});

test('mapMetarRow maps a full METAR row and derives the category', () => {
  const mapped = mapMetarRow({
    icaoId: 'KWWD',
    name: 'Cape May County Airport, NJ, United States',
    lat: 39.0021,
    lon: -74.9082,
    temp: 12,
    dewp: 8,
    wdir: 270,
    wspd: 12,
    wgst: 18,
    visib: '10+',
    altim: 30.02,
    rawOb: 'KWWD 161154Z AUTO 27012G18KT 10SM FEW030 SCT045 12/08 A3002',
    reportTime: '2026-11-16T11:54:00Z',
    clouds: [
      { cover: 'FEW', base: 3000 },
      { cover: 'BKN', base: 4500 },
    ],
    fltCat: null,
  });
  assert.equal(mapped.icao, 'KWWD');
  assert.equal(mapped.name, 'Cape May County Airport');
  assert.equal(mapped.flight_category, 'VFR');
  assert.equal(mapped.color, '#22c55e');
  assert.equal(mapped.visibility_sm, 10);
  assert.equal(mapped.ceiling_ft, 4500);
  assert.equal(mapped.wind_gust_kt, 18);
});

test('mapMetarRow keeps a regional station outside the big three', () => {
  const mapped = mapMetarRow({
    icaoId: 'KPHL',
    name: 'Philadelphia International Airport, PA, United States',
    lat: 39.8744,
    lon: -75.2424,
    visib: '1/2',
    fltCat: 'IFR',
    clouds: [{ cover: 'OVC', base: 600 }],
  });
  assert.equal(mapped.name, 'Philadelphia International Airport');
  assert.equal(mapped.flight_category, 'IFR');
  assert.equal(mapped.visibility_sm, 0.5);
  assert.equal(mapMetarRow({ icaoId: null }), null);
  assert.equal(mapMetarRow({ icaoId: 'KXYZ' }), null);
});

test('mapTafRows collapses whitespace and keeps raw text only', () => {
  assert.deepEqual(
    mapTafRows([
      { icaoId: 'KWWD', rawTAF: 'KWWD 161120Z 1612/1712\n 27012KT P6SM FEW030' },
      { icaoId: 'KACY', rawTAF: '' },
    ]),
    { KWWD: 'KWWD 161120Z 1612/1712 27012KT P6SM FEW030' },
  );
});
