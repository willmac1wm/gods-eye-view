import assert from 'node:assert/strict';
import test from 'node:test';
import { ingestEnabled, whisperModel } from './atcLive.js';

test('ingestEnabled defaults on when OPENAI_API_KEY is set', () => {
  assert.equal(
    ingestEnabled({ OPENAI_API_KEY: 'sk-test', ATC_LIVEATC_INGEST: '' }),
    true,
  );
  assert.equal(ingestEnabled({ OPENAI_API_KEY: '', ATC_LIVEATC_INGEST: '' }), false);
  assert.equal(
    ingestEnabled({ OPENAI_API_KEY: 'sk-test', ATC_LIVEATC_INGEST: '0' }),
    false,
  );
  assert.equal(
    ingestEnabled({ OPENAI_API_KEY: '', ATC_LIVEATC_INGEST: '1' }),
    true,
  );
});

test('whisperModel defaults to whisper-1', () => {
  assert.equal(whisperModel({}), 'whisper-1');
  assert.equal(whisperModel({ ATC_WHISPER_MODEL: 'whisper-1' }), 'whisper-1');
});
