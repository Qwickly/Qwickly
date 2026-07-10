import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldAllowOutboundToContact } from './whatsapp-outbound-policy.ts';

test('allows outbound to active clients even without recent inbound history', () => {
  assert.equal(shouldAllowOutboundToContact('active', false), true);
});

test('allows outbound when there is recent inbound history', () => {
  assert.equal(shouldAllowOutboundToContact('new', true), true);
});

test('blocks outbound for new contacts without recent inbound history', () => {
  assert.equal(shouldAllowOutboundToContact('new', false), false);
});
