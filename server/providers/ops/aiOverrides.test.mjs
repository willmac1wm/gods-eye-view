import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  _resetAiOverridesCacheForTests,
  readAiOverrides,
} from './aiOverrides.js';
import { withAiOverrides } from '../openai/instructions.js';
import { textInstructions } from '../common/textInstructions.js';
import { realtimeInstructions } from '../openai/instructions.js';

test('readAiOverrides fails open when store missing', async () => {
  _resetAiOverridesCacheForTests();
  const ai = await readAiOverrides({
    storePath: path.join(tmpdir(), 'gev-missing-manager-config.json'),
    force: true,
  });
  assert.deepEqual(ai, { briefOverride: '', askOverride: '' });
});

test('readAiOverrides returns stored brief/ask overrides', async () => {
  _resetAiOverridesCacheForTests();
  const dir = await mkdtemp(path.join(tmpdir(), 'gev-ai-ov-'));
  const storePath = path.join(dir, 'manager-config.json');
  await writeFile(
    storePath,
    JSON.stringify({
      ai: {
        briefOverride: ' Brief the tide first. ',
        askOverride: ' Prefer CAD before cameras. ',
      },
    }),
    'utf8',
  );
  try {
    const ai = await readAiOverrides({ storePath, force: true });
    assert.equal(ai.briefOverride, 'Brief the tide first.');
    assert.equal(ai.askOverride, 'Prefer CAD before cameras.');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('withAiOverrides leaves stock lines alone when empty', () => {
  const lines = withAiOverrides(['a', 'b'], {});
  assert.deepEqual(lines, ['a', 'b']);
});

test('realtimeInstructions injects manager overrides', () => {
  const text = realtimeInstructions(undefined, {
    askOverride: 'Ask override line',
    briefOverride: 'Brief override line',
  });
  assert.match(text, /OPERATOR SITUATION-BRIEF OVERRIDE/);
  assert.match(text, /Brief override line/);
  assert.match(text, /OPERATOR ASK OVERRIDE/);
  assert.match(text, /Ask override line/);
  const stock = realtimeInstructions();
  assert.doesNotMatch(stock, /OPERATOR ASK OVERRIDE/);
});

test('textInstructions injects ask override for chat path', () => {
  const text = textInstructions(undefined, {
    askOverride: 'Typed ask preamble',
  });
  assert.match(text, /GEV Chat/);
  assert.match(text, /OPERATOR ASK OVERRIDE/);
  assert.match(text, /Typed ask preamble/);
});
