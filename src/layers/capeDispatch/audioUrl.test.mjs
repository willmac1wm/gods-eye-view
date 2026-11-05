import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { rewriteCapeAudioUrl } from './audioUrl.js';

const fixture = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'fixtures/radioLiveChunk.json'),
    'utf8',
  ),
);

describe('rewriteCapeAudioUrl', () => {
  it('keeps same-origin cape paths', () => {
    assert.equal(
      rewriteCapeAudioUrl('/api/cape/fw-audio/a.mp3'),
      '/api/cape/fw-audio/a.mp3',
    );
  });

  it('maps Fire Wire relative audio paths', () => {
    assert.equal(
      rewriteCapeAudioUrl('/fw-audio/clip.mp3'),
      '/api/cape/fw-audio/clip.mp3',
    );
    assert.equal(
      rewriteCapeAudioUrl('/audio/clip.wav'),
      '/api/cape/audio/clip.wav',
    );
  });

  it('maps absolute Fire Wire audio URLs onto the proxy', () => {
    assert.equal(
      rewriteCapeAudioUrl('https://firewire.example/fw-audio/x.mp3?t=1'),
      '/api/cape/fw-audio/x.mp3?t=1',
    );
  });

  it('refuses non-Fire-Wire absolute URLs including LiveATC', () => {
    assert.equal(
      rewriteCapeAudioUrl('https://broadcastify.example/stream.mp3'),
      '',
    );
    assert.equal(
      rewriteCapeAudioUrl('https://www.liveatc.net/play/kwwd_twr.mp3'),
      '',
    );
  });

  it('rewrites the documented radio/live chunk fixture', () => {
    assert.equal(fixture.feed_id, 'cm-pd-1');
    assert.ok(fixture.chunk?.audio_url);
    assert.equal(
      rewriteCapeAudioUrl(fixture.chunk.audio_url),
      '/api/cape/fw-audio/cm-pd-1/2026-11-05T23-00-00Z.mp3',
    );
    assert.equal(
      rewriteCapeAudioUrl(
        `https://firewire.example${fixture.chunk.audio_url}`,
      ),
      '/api/cape/fw-audio/cm-pd-1/2026-11-05T23-00-00Z.mp3',
    );
  });
});
