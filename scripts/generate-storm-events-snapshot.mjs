#!/usr/bin/env node
/**
 * Regenerate src/layers/disasterHistory/stormEventsSnapshot.js from the
 * NOAA NCEI Storm Events bulk CSV files.
 *
 * Manual use only — NOT a CI step, NOT a runtime fetch (one year's
 * details file is ~12 MB gzipped and there is no query API for Storm
 * Events; NCEI's access API rejects dataset=stormevents).
 *
 * Usage:
 *   node scripts/generate-storm-events-snapshot.mjs [2025] [2024] ...
 * With no years given, regenerates every year already in the snapshot.
 * Each year resolves to the latest file for that year by listing the
 * NCEI index and picking the newest _cYYYYMMDD creation date.
 *
 * The filter is fixed: STATE == 'NEW JERSEY' and 'CAPE MAY' in CZ_NAME
 * (covers CAPE MAY, WESTERN CAPE MAY, EASTERN CAPE MAY). Never widen it
 * here without updating the layer spec — marine zones are excluded by
 * design.
 */
import { createWriteStream } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { get } from 'node:https';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE_URL = 'https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/';
const SNAPSHOT_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../src/layers/disasterHistory/stormEventsSnapshot.js',
);

function fetchText(url) {
  return new Promise((resolve, reject) => {
    get(url, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => resolve(body));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function latestFileForYear(year, indexHtml) {
  const names = [
    ...indexHtml.matchAll(
      new RegExp(`StormEvents_details-ftp_v1\\.0_d${year}_c\\d{8}\\.csv\\.gz`, 'g'),
    ),
  ].map((match) => match[0]);
  if (!names.length) throw new Error(`no details file for ${year} in the NCEI index`);
  return names.sort().at(-1);
}

// Minimal CSV split: Storm Events fields are quoted when they contain
// commas, and narratives contain quotes — use a small state machine
// instead of String.split(',').
function splitCsvLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

async function downloadYearRows(filename) {
  const url = `${BASE_URL}${filename}`;
  const rows = [];
  let header = null;
  let buffer = '';
  await pipeline(
    await new Promise((resolve, reject) => {
      get(url, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }
        resolve(res);
      }).on('error', reject);
    }),
    createGunzip(),
    async function* (source) {
      for await (const chunk of source) {
        buffer += chunk.toString('utf8');
        let newline = buffer.indexOf('\n');
        while (newline !== -1) {
          const line = buffer.slice(0, newline).replace(/\r$/, '');
          buffer = buffer.slice(newline + 1);
          if (!header) {
            header = splitCsvLine(line);
          } else if (line.trim()) {
            const values = splitCsvLine(line);
            const row = Object.fromEntries(
              header.map((name, i) => [name, values[i] ?? '']),
            );
            if (
              row.STATE === 'NEW JERSEY' &&
              (row.CZ_NAME ?? '').includes('CAPE MAY')
            ) {
              rows.push({
                event_id: row.EVENT_ID,
                episode_id: row.EPISODE_ID,
                event_type: row.EVENT_TYPE,
                cz_name: row.CZ_NAME,
                begin_date_time: row.BEGIN_DATE_TIME,
                end_date_time: row.END_DATE_TIME,
                damage_property: row.DAMAGE_PROPERTY || null,
                damage_crops: row.DAMAGE_CROPS || null,
                deaths_direct: Number(row.DEATHS_DIRECT) || 0,
                injuries_direct: Number(row.INJURIES_DIRECT) || 0,
                episode_narrative: (row.EPISODE_NARRATIVE ?? '').trim() || null,
                wfo: row.WFO,
              });
            }
          }
          newline = buffer.indexOf('\n');
        }
      }
    },
  );
  rows.sort((a, b) =>
    (a.begin_date_time ?? '') < (b.begin_date_time ?? '') ? -1 : 1,
  );
  return rows;
}

async function main() {
  const requested = process.argv.slice(2);
  const { STORM_EVENTS_SNAPSHOT } = await import(
    '../src/layers/disasterHistory/stormEventsSnapshot.js'
  ).catch(() => ({ STORM_EVENTS_SNAPSHOT: { years: {}, sourceFiles: {} } }));
  const years = requested.length
    ? requested
    : Object.keys(STORM_EVENTS_SNAPSHOT.years).sort();
  const indexHtml = await fetchText(BASE_URL);
  const nextYears = { ...STORM_EVENTS_SNAPSHOT.years };
  const nextFiles = { ...STORM_EVENTS_SNAPSHOT.sourceFiles };
  for (const year of years) {
    const filename = await latestFileForYear(year, indexHtml);
    const rows = await downloadYearRows(filename);
    console.log(`${year}: ${filename} → ${rows.length} county rows`);
    nextYears[year] = rows;
    nextFiles[year] = filename;
  }
  const snapshot = {
    source: 'NOAA NCEI Storm Events Database, bulk CSV files',
    baseUrl: BASE_URL,
    sourceFiles: nextFiles,
    filter: "STATE == 'NEW JERSEY' and 'CAPE MAY' in CZ_NAME",
    generated: new Date().toISOString().slice(0, 10),
    years: Object.fromEntries(
      Object.keys(nextYears)
        .sort()
        .map((year) => [year, nextYears[year]]),
    ),
  };
  const header =
    '// Static snapshot of NOAA NCEI Storm Events rows for Cape May County.\n' +
    `// Generated ${snapshot.generated} by scripts/generate-storm-events-snapshot.mjs from the\n` +
    '// NCEI bulk CSV files listed in STORM_EVENTS_SOURCE_FILES (no query API\n' +
    '// exists for Storm Events — NCEI\'s access API rejects dataset=stormevents).\n' +
    '// The provider serves this snapshot as-is; regenerate the file when a new\n' +
    '// year file lands. Never hand-edit rows: re-run the generator instead.\n\n';
  await writeFile(
    SNAPSHOT_PATH,
    `${header}export const STORM_EVENTS_SNAPSHOT = ${JSON.stringify(snapshot, null, 2)};\n`,
  );
  console.log(`wrote ${SNAPSHOT_PATH}`);
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
