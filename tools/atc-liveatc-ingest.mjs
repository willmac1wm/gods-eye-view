#!/usr/bin/env node
/**
 * Optional ATC transcript worker (old Cape liveatc_kacy.py role).
 * Probes Icecast via the same-origin GEV proxy (browser-UA + single-stream
 * mutex live there), optionally shells ATC_WHISPER_CMD on a temp segment,
 * POSTs transcript chunks to GEV /api/ops/atc/ingest with manager Bearer.
 *
 * Usage:
 *   CAPE_MANAGER_TOKEN=… ATC_GEV_ORIGIN=http://127.0.0.1:5173 \
 *     ATC_LIVEATC_INGEST=1 ATC_WHISPER_CMD='…' \
 *     node tools/atc-liveatc-ingest.mjs [--mount kacy_a_twr]
 *
 * Exits without CAPE_MANAGER_TOKEN. On 403/429/503 liveatc_blocked from the
 * proxy, prints the exact response and exits — do not rotate UAs or hammer.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const origin = String(process.env.ATC_GEV_ORIGIN || 'http://127.0.0.1:5173').replace(
  /\/$/,
  '',
);
const token = String(process.env.CAPE_MANAGER_TOKEN || '').trim();
const whisperCmd = String(process.env.ATC_WHISPER_CMD || '').trim();
const mountArg = process.argv.includes('--mount')
  ? process.argv[process.argv.indexOf('--mount') + 1]
  : 'kacy_a_twr';

if (!token) {
  console.error('CAPE_MANAGER_TOKEN required');
  process.exit(1);
}

async function sampleMount(mount) {
  const url = `${origin}/api/ops/atc/stream?mount=${encodeURIComponent(mount)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  const response = await fetch(url, { signal: controller.signal });
  clearTimeout(timer);
  if (!response.ok) {
    let body = '';
    try {
      body = await response.text();
    } catch {
      /* ignore */
    }
    const err = new Error(`stream_${response.status}`);
    err.status = response.status;
    err.body = body;
    throw err;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (size < 64_000) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
    size += value.length;
  }
  try {
    await reader.cancel();
  } catch {
    /* ignore */
  }
  return Buffer.concat(chunks);
}

function runWhisper(filePath) {
  return new Promise((resolve) => {
    if (!whisperCmd) {
      resolve(null);
      return;
    }
    const child = spawn(whisperCmd, [filePath], { shell: true });
    let out = '';
    child.stdout.on('data', (d) => {
      out += d;
    });
    child.on('close', () => resolve(out.trim() || null));
    child.on('error', () => resolve(null));
  });
}

async function postChunk(body) {
  const response = await fetch(`${origin}/api/ops/atc/ingest`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`ingest_${response.status}`);
  }
  return response.json();
}

const dir = await mkdtemp(path.join(tmpdir(), 'gev-atc-'));
try {
  const buf = await sampleMount(mountArg);
  const file = path.join(dir, `${mountArg}.mp3`);
  await writeFile(file, buf);
  const transcript = await runWhisper(file);
  const result = await postChunk({
    mount: mountArg,
    transcript,
    duration_ms: null,
    source: 'atc-liveatc-ingest',
    audio_url: true,
  });
  console.log(JSON.stringify(result, null, 2));
  if (!transcript) {
    console.error(
      'Note: no transcript (set ATC_WHISPER_CMD for STT). Chunk stored with null transcript.',
    );
  }
} catch (error) {
  if (error?.status === 403 || error?.status === 429 || error?.status === 503) {
    console.error(
      JSON.stringify(
        {
          error: 'liveatc_refused',
          status: error.status,
          body: String(error.body || '').slice(0, 800),
          detail:
            'LiveATC/proxy refused. Do not rotate User-Agents or retry rapidly.',
        },
        null,
        2,
      ),
    );
    process.exit(2);
  }
  throw error;
} finally {
  await rm(dir, { recursive: true, force: true });
}
