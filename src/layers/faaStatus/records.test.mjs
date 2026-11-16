import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FAA_STATUS_LOCAL_AIRPORTS,
  parseFeedDate,
  parseNasStatusXml,
} from './records.js';

// Live NAS feed fetched 2026-11-16 ~19:28 UTC (verbatim, whitespace only).
const LIVE_XML =
  '<AIRPORT_STATUS_INFORMATION><Update_Time>Mon Nov 16 19:28:03 2026 GMT</Update_Time>' +
  '<Dtd_File>http://www.fly.faa.gov/AirportStatus.dtd</Dtd_File>' +
  '<Delay_type><Name>Ground Stop Programs</Name><Ground_Stop_List>' +
  '<Program><ARPT>LGA</ARPT><Reason>airspace volume</Reason><End_Time>2:45 pm EST</End_Time></Program>' +
  '<Program><ARPT>AUS</ARPT><Reason>runway construction</Reason><End_Time>2:15 pm CST</End_Time></Program>' +
  '</Ground_Stop_List></Delay_type>' +
  '<Delay_type><Name>Ground Delay Programs</Name><Ground_Delay_List>' +
  '<Ground_Delay><ARPT>SAN</ARPT><Reason>airport volume</Reason><Avg>36 minutes</Avg><Max>1 hour and 12 minutes</Max></Ground_Delay>' +
  '<Ground_Delay><ARPT>SFO</ARPT><Reason>low ceilings</Reason><Avg>1 hour and 5 minutes</Avg><Max>2 hours and 28 minutes</Max></Ground_Delay>' +
  '</Ground_Delay_List></Delay_type>' +
  '<Delay_type><Name>General Arrival/Departure Delay Info</Name><Arrival_Departure_Delay_List>' +
  '<Delay><ARPT>LGA</ARPT><Reason>WX:Wind</Reason><Arrival_Departure Type="Departure"><Min>16 minutes</Min><Max>30 minutes</Max><Trend>Increasing</Trend></Arrival_Departure></Delay>' +
  '<Delay><ARPT>SAN</ARPT><Reason>VOL:Volume</Reason><Arrival_Departure Type="Departure"><Min>16 minutes</Min><Max>30 minutes</Max><Trend>Increasing</Trend></Arrival_Departure></Delay>' +
  '</Arrival_Departure_Delay_List></Delay_type>' +
  '<Delay_type><Name>Airport Closures</Name><Airport_Closure_List>' +
  '<Airport><ARPT>SNA</ARPT><Reason>!SNA 11/020 SNA AD AP CLSD DLY 0730-1415 2611150730-2611211415</Reason><Start>Nov 15 at 07:30 UTC.</Start><Reopen>Nov 21 at 14:15 UTC.</Reopen></Airport>' +
  '</Airport_Closure_List></Delay_type>' +
  '<Delay_type><Name>Airport Closures</Name><Airport_Closure_List>' +
  '<Airport><ARPT>LAX</ARPT><Reason>!LAX 05/277 LAX AD AP CLSD TO NON SKED TRANSIENT GA ACFT EXC 24HR PPR CTC ATLANTIC AVIATION 310-258-9884 OR SIGNATURE AVIATION 310-410-9605 2605271826-2705281600</Reason><Start>May 27 at 18:26 UTC.</Start><Reopen>May 28 at 16:00 UTC.</Reopen></Airport>' +
  '<Airport><ARPT>SAN</ARPT><Reason>!SAN 10/004 SAN AD AP CLSD TO NON SKED TRANSIENT GA ACFT EXC PPR 619-298-7704 2610011633-2701010800</Reason><Start>Oct 01 at 16:33 UTC.</Start><Reopen>Jan 01 at 08:00 UTC.</Reopen></Airport>' +
  '<Airport><ARPT>LAS</ARPT><Reason>!LAS 10/160 LAS AD AP CLSD TO NON SKED TRANSIENT GA ACFT EXC 24HR PPR 702-261-7775 2610281926-2701272300</Reason><Start>Oct 28 at 19:26 UTC.</Start><Reopen>Jan 27 at 23:00 UTC.</Reopen></Airport>' +
  '</Airport_Closure_List></Delay_type></AIRPORT_STATUS_INFORMATION>';

test('live feed parses: nationwide counts, distinct airports, no local events', () => {
  const parsed = parseNasStatusXml(LIVE_XML);
  assert.equal(parsed.updateTime, 'Mon Nov 16 19:28:03 2026 GMT');
  assert.equal(
    parsed.updateTimeMs,
    Date.parse('Mon Nov 16 19:28:03 2026 GMT'),
  );
  assert.deepEqual(parsed.nationwide, {
    groundStop: 2,
    groundDelay: 2,
    closure: 4,
    arrivalDepartureDelay: 2,
  });
  assert.equal(parsed.totalAirports, 7);
  assert.deepEqual(parsed.local, []);
});

test('two Airport Closures blocks accumulate instead of overwriting', () => {
  const parsed = parseNasStatusXml(LIVE_XML);
  assert.equal(parsed.nationwide.closure, 4);
});

test('arrival/departure entries carry type, min, max and trend', () => {
  const parsed = parseNasStatusXml(
    '<AIRPORT_STATUS_INFORMATION><Update_Time>Mon Nov 16 19:28:03 2026 GMT</Update_Time>' +
      '<Delay_type><Name>General Arrival/Departure Delay Info</Name><Arrival_Departure_Delay_List>' +
      '<Delay><ARPT>EWR</ARPT><Reason>WX:Wind</Reason><Arrival_Departure Type="Arrival"><Min>16 minutes</Min><Max>30 minutes</Max><Trend>Increasing</Trend></Arrival_Departure></Delay>' +
      '</Arrival_Departure_Delay_List></Delay_type></AIRPORT_STATUS_INFORMATION>',
  );
  assert.equal(parsed.local.length, 1);
  assert.deepEqual(parsed.local[0], {
    airport: 'EWR',
    category: 'arrival-departure',
    reason: 'WX:Wind',
    start: null,
    reopen: null,
    endTime: null,
    avg: '16 minutes',
    max: '30 minutes',
    trend: 'Increasing',
    delayType: 'Arrival',
    startMs: null,
    reopenMs: null,
  });
});

test('local ground stop and ground delay parse with their fields', () => {
  const parsed = parseNasStatusXml(
    '<AIRPORT_STATUS_INFORMATION><Update_Time>Mon Nov 16 19:28:03 2026 GMT</Update_Time>' +
      '<Delay_type><Name>Ground Stop Programs</Name><Ground_Stop_List>' +
      '<Program><ARPT>ACY</ARPT><Reason>telecom failure</Reason><End_Time>09:00 pm EST</End_Time></Program>' +
      '</Ground_Stop_List></Delay_type>' +
      '<Delay_type><Name>Ground Delay Programs</Name><Ground_Delay_List>' +
      '<Ground_Delay><ARPT>PHL</ARPT><Reason>low ceilings</Reason><Avg>1 hour and 5 minutes</Avg><Max>2 hours and 28 minutes</Max></Ground_Delay>' +
      '</Ground_Delay_List></Delay_type></AIRPORT_STATUS_INFORMATION>',
  );
  assert.equal(parsed.local.length, 2);
  assert.equal(parsed.local[0].airport, 'ACY');
  assert.equal(parsed.local[0].category, 'ground-stop');
  assert.equal(parsed.local[0].reason, 'telecom failure');
  assert.equal(parsed.local[0].endTime, '09:00 pm EST');
  assert.equal(parsed.local[1].airport, 'PHL');
  assert.equal(parsed.local[1].category, 'ground-delay');
  assert.equal(parsed.local[1].avg, '1 hour and 5 minutes');
  assert.equal(parsed.local[1].max, '2 hours and 28 minutes');
  assert.deepEqual(parsed.nationwide, {
    groundStop: 1,
    groundDelay: 1,
    closure: 0,
    arrivalDepartureDelay: 0,
  });
});

test('a January reopen against an October update rolls to the next year', () => {
  // SAN closure in the live feed: Start Oct 01 2026, Reopen Jan 01 2027 —
  // check via a local closure so the event is reachable in `local`.
  const local = parseNasStatusXml(
    '<AIRPORT_STATUS_INFORMATION><Update_Time>Mon Nov 16 19:28:03 2026 GMT</Update_Time>' +
      '<Delay_type><Name>Airport Closures</Name><Airport_Closure_List>' +
      '<Airport><ARPT>ACY</ARPT><Reason>!ACY test</Reason><Start>Oct 01 at 16:33 UTC.</Start><Reopen>Jan 01 at 08:00 UTC.</Reopen></Airport>' +
      '</Airport_Closure_List></Delay_type></AIRPORT_STATUS_INFORMATION>',
  );
  assert.equal(
    local.local[0].startMs,
    Date.UTC(2026, 9, 1, 16, 33),
  );
  assert.equal(
    local.local[0].reopenMs,
    Date.UTC(2027, 0, 1, 8, 0),
  );
  assert.equal(
    parseFeedDate('Dec 31 at 23:00 UTC.', Date.parse('Mon Jan 05 12:00:00 2026 GMT')),
    Date.UTC(2025, 11, 31, 23, 0),
  );
  assert.equal(
    parseFeedDate('Nov 16 at 07:30 UTC.', Date.parse('Mon Nov 16 19:28:03 2026 GMT')),
    Date.UTC(2026, 10, 16, 7, 30),
  );
  assert.equal(parseFeedDate('not a date', Date.now()), null);
});

test('malformed feeds throw instead of half-parsing', () => {
  for (const bad of [
    '',
    '<html>nope</html>',
    '<AIRPORT_STATUS_INFORMATION></AIRPORT_STATUS_INFORMATION>',
    '<AIRPORT_STATUS_INFORMATION><Update_Time>garbage</Update_Time></AIRPORT_STATUS_INFORMATION>',
  ]) {
    assert.throws(() => parseNasStatusXml(bad), /Malformed/);
  }
});

test('unknown delay-type blocks are skipped, known ones still parse', () => {
  const parsed = parseNasStatusXml(
    '<AIRPORT_STATUS_INFORMATION><Update_Time>Mon Nov 16 19:28:03 2026 GMT</Update_Time>' +
      '<Delay_type><Name>Something New</Name><Ground_Stop_List>' +
      '<Program><ARPT>ACY</ARPT><Reason>?</Reason><End_Time>?</End_Time></Program>' +
      '</Ground_Stop_List></Delay_type>' +
      '<Delay_type><Name>Ground Stop Programs</Name><Ground_Stop_List>' +
      '<Program><ARPT>ACY</ARPT><Reason>telecom failure</Reason><End_Time>09:00 pm EST</End_Time></Program>' +
      '</Ground_Stop_List></Delay_type></AIRPORT_STATUS_INFORMATION>',
  );
  assert.equal(parsed.local.length, 1);
  assert.equal(parsed.nationwide.groundStop, 1);
});

test('local airports carry coordinates', () => {
  assert.deepEqual(FAA_STATUS_LOCAL_AIRPORTS.ACY, {
    name: 'Atlantic City Intl',
    lat: 39.4576,
    lon: -74.5772,
  });
  assert.deepEqual(FAA_STATUS_LOCAL_AIRPORTS.PHL, {
    name: 'Philadelphia Intl',
    lat: 39.8744,
    lon: -75.2424,
  });
  assert.deepEqual(FAA_STATUS_LOCAL_AIRPORTS.EWR, {
    name: 'Newark Liberty Intl',
    lat: 40.6895,
    lon: -74.1745,
  });
});
