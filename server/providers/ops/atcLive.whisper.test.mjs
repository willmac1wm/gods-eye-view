import assert from 'node:assert/strict';
import test from 'node:test';
import { ingestEnabled, localWhisperCmd, STREAM_UA } from './atcLive.js';

test('ingestEnabled is explicit-only (no OpenAI default-on)', () => {
  assert.equal(ingestEnabled({ ATC_LIVEATC_INGEST: '' }), false);
  assert.equal(
    ingestEnabled({ OPENAI_API_KEY: 'sk-test', ATC_LIVEATC_INGEST: '' }),
    false,
  );
  assert.equal(ingestEnabled({ ATC_LIVEATC_INGEST: '0' }), false);
  assert.equal(ingestEnabled({ ATC_LIVEATC_INGEST: '1' }), true);
});

test('localWhisperCmd reads ATC_WHISPER_CMD only', () => {
  assert.equal(localWhisperCmd({}), '');
  assert.equal(
    localWhisperCmd({ ATC_WHISPER_CMD: 'whisper-cli --model tiny' }),
    'whisper-cli --model tiny',
  );
});

test('STREAM_UA is fixed desktop Chrome (not VLC)', () => {
  assert.match(STREAM_UA, /Mozilla\/5\.0/);
  assert.match(STREAM_UA, /Chrome\/131/);
  assert.doesNotMatch(STREAM_UA, /VLC|LibVLC/i);
});
