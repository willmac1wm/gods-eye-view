#!/usr/bin/env node
/**
 * Loopback operator tool for community reports stored under
 * `.gev-data/community-reports/`.
 *
 * Reports stay private (`pending-review`) until an operator on the server
 * machine runs this CLI. There is no HTTP moderation surface — that keeps
 * approve/reject off the public tunnel.
 *
 * Usage:
 *   node scripts/moderate-reports.mjs list
 *   node scripts/moderate-reports.mjs show <id>
 *   node scripts/moderate-reports.mjs approve <id> [--verify]
 *   node scripts/moderate-reports.mjs reject <id> [--reason "..."]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectRoot } from './project-root.mjs';

const ROOT = projectRoot(import.meta.url);
const REPORT_DIR = path.join(ROOT, '.gev-data', 'community-reports');
const STATUSES = new Set(['pending-review', 'approved', 'rejected']);

export function reportDir(root = ROOT) {
  return path.join(root, '.gev-data', 'community-reports');
}

export function listReports(dir = REPORT_DIR) {
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  } catch {
    return [];
  }
  const rows = [];
  for (const file of files) {
    try {
      const record = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      if (!record?.id) continue;
      rows.push(record);
    } catch {
      /* skip corrupt */
    }
  }
  return rows;
}

export function readReport(id, dir = REPORT_DIR) {
  const safe = String(id || '').trim();
  if (!/^[0-9]+-[a-f0-9]+$/i.test(safe)) {
    throw Object.assign(new Error('Invalid report id'), { code: 'BAD_ID' });
  }
  const file = path.join(dir, `${safe}.json`);
  if (!fs.existsSync(file)) {
    throw Object.assign(new Error(`No report ${safe}`), { code: 'MISSING' });
  }
  return {
    file,
    record: JSON.parse(fs.readFileSync(file, 'utf8')),
  };
}

export function writeReport(file, record) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`);
  fs.renameSync(tmp, file);
  return record;
}

export function approveReport(id, { verify = false, dir = REPORT_DIR } = {}) {
  const { file, record } = readReport(id, dir);
  if (record.status === 'rejected') {
    throw Object.assign(new Error('Rejected reports cannot be approved'), {
      code: 'REJECTED',
    });
  }
  record.status = 'approved';
  record.visibility = 'public';
  record.verified = Boolean(verify);
  record.reviewedAt = new Date().toISOString();
  delete record.rejectReason;
  return writeReport(file, record);
}

export function rejectReport(id, { reason = '', dir = REPORT_DIR } = {}) {
  const { file, record } = readReport(id, dir);
  record.status = 'rejected';
  record.visibility = 'private';
  record.verified = false;
  record.reviewedAt = new Date().toISOString();
  const cleaned = String(reason || '')
    .replace(/[<>]/g, '')
    .trim()
    .slice(0, 240);
  if (cleaned) record.rejectReason = cleaned;
  else delete record.rejectReason;
  return writeReport(file, record);
}

function printList(rows, { status } = {}) {
  const filtered = status ? rows.filter((r) => r.status === status) : rows;
  if (!filtered.length) {
    console.log(status ? `No ${status} reports.` : 'No reports on disk.');
    return;
  }
  for (const r of filtered) {
    const where = r.town || (r.lat != null ? `${r.lat},${r.lon}` : 'no-loc');
    console.log(
      `${r.id}\t${r.status}\t${r.visibility}\t${r.category}\t${where}\t${(r.text || '').slice(0, 80)}`,
    );
  }
}

function printShow(record) {
  console.log(JSON.stringify(record, null, 2));
}

function usage() {
  console.log(`Community report moderator (local disk only)

  node scripts/moderate-reports.mjs list [--status pending-review|approved|rejected]
  node scripts/moderate-reports.mjs show <id>
  node scripts/moderate-reports.mjs approve <id> [--verify]
  node scripts/moderate-reports.mjs reject <id> [--reason "..."]

Reports live in ${REPORT_DIR}
Approved + public reports appear on GET /api/local/reports.`);
}

function parseArgs(argv) {
  const args = [...argv];
  const cmd = args.shift() || 'help';
  const flags = {};
  const positionals = [];
  while (args.length) {
    const next = args.shift();
    if (next === '--verify') flags.verify = true;
    else if (next === '--status') flags.status = args.shift();
    else if (next === '--reason') flags.reason = args.shift();
    else if (next.startsWith('-')) {
      throw Object.assign(new Error(`Unknown flag ${next}`), { code: 'USAGE' });
    } else positionals.push(next);
  }
  if (flags.status && !STATUSES.has(flags.status)) {
    throw Object.assign(new Error(`Unknown status ${flags.status}`), {
      code: 'USAGE',
    });
  }
  return { cmd, flags, positionals };
}

export function runCli(argv = process.argv.slice(2), io = console) {
  const { cmd, flags, positionals } = parseArgs(argv);
  if (cmd === 'help' || cmd === '--help' || cmd === '-h') {
    usage();
    return 0;
  }
  if (cmd === 'list') {
    printList(listReports(), { status: flags.status });
    return 0;
  }
  if (cmd === 'show') {
    const id = positionals[0];
    if (!id) throw Object.assign(new Error('show requires <id>'), { code: 'USAGE' });
    printShow(readReport(id).record);
    return 0;
  }
  if (cmd === 'approve') {
    const id = positionals[0];
    if (!id)
      throw Object.assign(new Error('approve requires <id>'), { code: 'USAGE' });
    const record = approveReport(id, { verify: flags.verify });
    io.log(
      `approved ${record.id} visibility=${record.visibility} verified=${record.verified}`,
    );
    return 0;
  }
  if (cmd === 'reject') {
    const id = positionals[0];
    if (!id)
      throw Object.assign(new Error('reject requires <id>'), { code: 'USAGE' });
    const record = rejectReport(id, { reason: flags.reason });
    io.log(`rejected ${record.id}`);
    return 0;
  }
  throw Object.assign(new Error(`Unknown command ${cmd}`), { code: 'USAGE' });
}

const isDirectRun =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  try {
    process.exitCode = runCli();
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = error.code === 'USAGE' ? 2 : 1;
  }
}
