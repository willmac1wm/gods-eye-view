import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isRetiredCapeWebsite,
  resolveCapeUpstream,
} from './capeUpstream.js';

describe('resolveCapeUpstream', () => {
  it('prefers FIREWIRE_URL over CAPE_DISPATCH_URL', () => {
    assert.equal(
      resolveCapeUpstream({
        FIREWIRE_URL: 'https://firewire.example/',
        CAPE_DISPATCH_URL: 'https://legacy.example',
      }),
      'https://firewire.example',
    );
  });

  it('falls back to CAPE_DISPATCH_URL', () => {
    assert.equal(
      resolveCapeUpstream({ CAPE_DISPATCH_URL: 'http://127.0.0.1:9' }),
      'http://127.0.0.1:9',
    );
  });

  it('returns null when unset', () => {
    assert.equal(resolveCapeUpstream({}), null);
  });

  it('rejects non-http schemes', () => {
    assert.equal(resolveCapeUpstream({ FIREWIRE_URL: 'ftp://x' }), null);
  });
});

describe('isRetiredCapeWebsite', () => {
  it('flags the old public site', () => {
    assert.equal(isRetiredCapeWebsite('https://capemaydispatch.com'), true);
    assert.equal(
      isRetiredCapeWebsite('https://www.capemaydispatch.com/'),
      true,
    );
    assert.equal(isRetiredCapeWebsite('https://firewire.example'), false);
    assert.equal(isRetiredCapeWebsite(null), false);
  });
});
