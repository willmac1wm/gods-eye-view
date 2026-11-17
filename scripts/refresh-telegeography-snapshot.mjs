#!/usr/bin/env node
/**
 * Refresh the bundled TeleGeography submarine-cable snapshot from the
 * public Submarine Cable Map GeoJSON endpoints.
 *
 * Manual use only — NOT a CI step, NOT a runtime fetch. The snapshot
 * is bundled so the cables layer works out of the box; refresh it by
 * hand when the map has moved on (new systems land every few months).
 *
 * Usage:
 *   node scripts/refresh-telegeography-snapshot.mjs          # dry run: fetch, validate, report
 *   node scripts/refresh-telegeography-snapshot.mjs --write  # replace the bundled files
 *
 * A dry run fetches both endpoints, validates the shape, and reports
 * what would change: feature counts, sha256, and whether the three
 * New Jersey landings (Tuckerton, Wall Township, Manasquan) are still
 * there and unmoved. --write replaces the two GeoJSON files, updates
 * source.json (downloaded_at, feature_count, sha256) and the README
 * counts — then you MUST update the pins in
 * src/layers/submarineCables/bundledSnapshot.test.mjs (cable/landing
 * counts, hashes, NJ coordinates if they moved) and re-run the suite.
 *
 * Guardrails: both endpoints are keyless public GeoJSON (verified
 * serving 2026-11-17). Counts must clear a sanity floor (cables >=
 * 500, landings >= 1500) and must not drop more than 10% vs the
 * bundled snapshot — a bigger drop means the upstream shape changed
 * and a human should look before overwriting. The dataset is
 * CC BY-NC-SA 3.0: refreshing the files does not change the license.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(
  ROOT,
  'src/data/local_data/telegeography_submarine_cables',
);
const USER_AGENT =
  'gods-eye-view-snapshot-refresh (+https://github.com/willmac1wm/gods-eye-view)';
const MAX_BYTES = 10_000_000;
const FETCH_TIMEOUT_MS = 30_000;

const FILES = [
  {
    key: 'cables',
    file: 'cable-geo.json',
    url: 'https://www.submarinecablemap.com/api/v3/cable/cable-geo.json',
    floor: 500,
  },
  {
    key: 'landings',
    file: 'landing-point-geo.json',
    url: 'https://www.submarinecablemap.com/api/v3/landing-point/landing-point-geo.json',
    floor: 1500,
  },
];

// [lon, lat] as pinned in bundledSnapshot.test.mjs.
const NEW_JERSEY_LANDINGS = {
  'Tuckerton, NJ, United States': [-74.33791021235805, 39.60388495499803],
  'Wall Township, NJ, United States': [-74.06287361347052, 40.15287376160566],
  'Manasquan, NJ, United States': [-74.04704127778734, 40.12334092150613],
};

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function fetchGeoJson({ url }) {
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > MAX_BYTES) {
    throw new Error(`response over ${MAX_BYTES} bytes for ${url}`);
  }
  const doc = JSON.parse(new TextDecoder().decode(bytes));
  if (doc?.type !== 'FeatureCollection' || !Array.isArray(doc.features)) {
    throw new Error(`not a FeatureCollection: ${url}`);
  }
  return { doc, bytes };
}

function main() {
  const write = process.argv.includes('--write');
  const today = new Date().toISOString().slice(0, 10);
  const manifest = JSON.parse(
    readFileSync(path.join(DATA_DIR, 'source.json'), 'utf8'),
  );
  const readmePath = path.join(DATA_DIR, 'README.md');
  const readme = readFileSync(readmePath, 'utf8');

  const report = [];
  const updates = [];
  let failed = false;

  return (async () => {
    for (const spec of FILES) {
      const bundled = JSON.parse(
        readFileSync(path.join(DATA_DIR, spec.file), 'utf8'),
      );
      const oldCount = bundled.features.length;
      const { doc, bytes } = await fetchGeoJson(spec);
      const newCount = doc.features.length;
      const hash = sha256(bytes);
      const drop = oldCount - newCount;
      const status = [];
      if (newCount < spec.floor) {
        failed = true;
        status.push(`FAIL below floor ${spec.floor}`);
      } else if (drop > oldCount * 0.1) {
        failed = true;
        status.push(`FAIL dropped ${drop} (${((drop / oldCount) * 100).toFixed(1)}% > 10%)`);
      } else if (drop > 0) {
        status.push(`warn dropped ${drop}`);
      }
      report.push(
        `${spec.key}: ${oldCount} -> ${newCount} features, sha256 ${hash.slice(0, 16)}…${status.length ? ` [${status.join('; ')}]` : ''}`,
      );
      updates.push({ spec, doc, bytes, newCount, hash });
    }

    const landings = updates.find(({ spec }) => spec.key === 'landings').doc;
    const byName = new Map(
      landings.features.map((feature) => [feature.properties?.name, feature]),
    );
    for (const [name, coordinates] of Object.entries(NEW_JERSEY_LANDINGS)) {
      const feature = byName.get(name);
      if (!feature) {
        failed = true;
        report.push(`NJ landing MISSING in fresh data: ${name}`);
        continue;
      }
      const [lon, lat] = feature.geometry?.coordinates ?? [];
      const moved =
        Math.abs(lon - coordinates[0]) > 0.01 ||
        Math.abs(lat - coordinates[1]) > 0.01;
      report.push(
        `NJ landing ${name}: [${lon}, ${lat}]${moved ? ' [MOVED — update the test pin]' : ''}`,
      );
    }

    console.log(report.join('\n'));
    if (failed) {
      console.error(
        'REFRESH ABORTED: a guardrail failed — do not overwrite the snapshot.',
      );
      process.exitCode = 1;
      return;
    }
    if (!write) {
      console.log(
        '\nDry run only — nothing written. Re-run with --write to replace the snapshot.',
      );
      return;
    }

    for (const { spec, bytes, newCount, hash } of updates) {
      writeFileSync(path.join(DATA_DIR, spec.file), bytes);
      const entry = manifest.files.find((row) => row.path === spec.file);
      entry.feature_count = newCount;
      entry.sha256 = hash;
    }
    manifest.downloaded_at = today;
    writeFileSync(
      path.join(DATA_DIR, 'source.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    let nextReadme = readme;
    nextReadme = nextReadme.replace(
      /\| `cable-geo\.json` \| `[^`]+` \| [\d,]+ cables \|/,
      `| \`cable-geo.json\` | \`https://www.submarinecablemap.com/api/v3/cable/cable-geo.json\` | ${updates[0].newCount.toLocaleString('en-US')} cables |`,
    );
    nextReadme = nextReadme.replace(
      /\| `landing-point-geo\.json` \| `[^`]+` \| [\d,]+ landing points \|/,
      `| \`landing-point-geo.json\` | \`https://www.submarinecablemap.com/api/v3/landing-point/landing-point-geo.json\` | ${updates[1].newCount.toLocaleString('en-US')} landing points |`,
    );
    nextReadme = nextReadme.replace(
      /Downloaded \d{4}-\d{2}-\d{2}\./,
      `Downloaded ${today}.`,
    );
    writeFileSync(readmePath, nextReadme);

    console.log(
      `\nSnapshot refreshed (${today}). Now update the pins in src/layers/submarineCables/bundledSnapshot.test.mjs (counts, hashes, NJ coordinates if moved) and re-run the suite.`,
    );
  })().catch((error) => {
    console.error(`REFRESH FAILED: ${error.message}`);
    process.exitCode = 1;
  });
}

main();
