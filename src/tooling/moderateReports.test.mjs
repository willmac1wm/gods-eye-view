import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  approveReport,
  listReports,
  rejectReport,
  reportDir,
} from '../../scripts/moderate-reports.mjs';

function fixtureDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gev-moderate-'));
  const reports = reportDir(dir);
  fs.mkdirSync(reports, { recursive: true });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return reports;
}

function writePending(dir, id, overrides = {}) {
  const record = {
    id,
    createdAt: '2026-11-10T00:00:00.000Z',
    category: 'flooding',
    text: 'Water over the curb near the ferry.',
    town: 'Cape May',
    lat: 38.968,
    lon: -74.96,
    photo: null,
    status: 'pending-review',
    visibility: 'private',
    verified: false,
    ...overrides,
  };
  fs.writeFileSync(
    path.join(dir, `${id}.json`),
    JSON.stringify(record, null, 2),
  );
  return record;
}

test('listReports reads pending files and skips corrupt ones', (t) => {
  const dir = fixtureDir(t);
  writePending(dir, '1762740000000-abcd');
  fs.writeFileSync(path.join(dir, 'broken.json'), '{');
  const rows = listReports(dir);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, '1762740000000-abcd');
  assert.equal(rows[0].status, 'pending-review');
});

test('approve makes a pending report public and optionally verified', (t) => {
  const dir = fixtureDir(t);
  writePending(dir, '1762740000001-ab01');
  const approved = approveReport('1762740000001-ab01', {
    verify: true,
    dir,
  });
  assert.equal(approved.status, 'approved');
  assert.equal(approved.visibility, 'public');
  assert.equal(approved.verified, true);
  assert.ok(approved.reviewedAt);
  const onDisk = JSON.parse(
    fs.readFileSync(path.join(dir, '1762740000001-ab01.json'), 'utf8'),
  );
  assert.equal(onDisk.visibility, 'public');
});

test('reject keeps the report private and records a sanitized reason', (t) => {
  const dir = fixtureDir(t);
  writePending(dir, '1762740000002-ab02');
  const rejected = rejectReport('1762740000002-ab02', {
    reason: 'spam <script>',
    dir,
  });
  assert.equal(rejected.status, 'rejected');
  assert.equal(rejected.visibility, 'private');
  assert.equal(rejected.verified, false);
  assert.equal(rejected.rejectReason, 'spam script');
});

test('approve refuses a previously rejected report', (t) => {
  const dir = fixtureDir(t);
  writePending(dir, '1762740000003-ab03', {
    status: 'rejected',
    visibility: 'private',
  });
  assert.throws(
    () => approveReport('1762740000003-ab03', { dir }),
    (error) => error.code === 'REJECTED',
  );
});

test('path traversal ids are refused', (t) => {
  const dir = fixtureDir(t);
  assert.throws(
    () => approveReport('../etc/passwd', { dir }),
    (error) => error.code === 'BAD_ID',
  );
});
