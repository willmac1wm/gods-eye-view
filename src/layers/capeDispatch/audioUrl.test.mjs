import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { rewriteCapeAudioUrl } from './audioUrl.js';

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

  it('refuses non-Fire-Wire absolute URLs', () => {
    assert.equal(
      rewriteCapeAudioUrl('https://broadcastify.example/stream.mp3'),
      '',
    );
  });
});
