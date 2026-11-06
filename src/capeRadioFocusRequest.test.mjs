import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CAPE_RADIO_OPEN_EVENT,
  openCapeRadioFromRequest,
  requestCapeRadio,
} from './capeRadioFocusRequest.js';

describe('requestCapeRadio', () => {
  it('dispatches when feedId or audioUrl is present', () => {
    const events = [];
    const target = {
      dispatchEvent(event) {
        events.push(event);
        return true;
      },
    };
    assert.equal(requestCapeRadio({ feedId: '37982' }, target), true);
    assert.equal(events[0].type, CAPE_RADIO_OPEN_EVENT);
    assert.equal(events[0].detail.feedId, '37982');
    assert.equal(requestCapeRadio({}, target), false);
  });
});

describe('openCapeRadioFromRequest', () => {
  it('enables radio, opens the panel, and plays', async () => {
    const calls = [];
    const ok = await openCapeRadioFromRequest(
      { detail: { feedId: '1', name: 'County' } },
      {
        enabled: () => false,
        enable: async () => {
          calls.push('enable');
        },
        openPanel: () => calls.push('panel'),
        playCape: async (detail) => {
          calls.push(`play:${detail.feedId}`);
          return true;
        },
      },
    );
    assert.equal(ok, true);
    assert.deepEqual(calls, ['enable', 'panel', 'play:1']);
  });
});
