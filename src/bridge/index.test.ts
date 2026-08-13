import assert from 'node:assert/strict';
import test from 'node:test';

test('bridge entry exports browser APIs and no Node server', async () => {
  const bridge = await import('./index.js');
  assert.equal(typeof bridge.connectMapLibreBridge, 'function');
  assert.equal(bridge.BRIDGE_PROTOCOL_VERSION, 1);
  assert.equal(typeof bridge.canonicalizeJson, 'function');
  assert.equal(typeof bridge.sha256CanonicalJson, 'function');
  assert.equal('createBridgeServer' in bridge, false);
  assert.equal('LiveMapRegistry' in bridge, false);
});
