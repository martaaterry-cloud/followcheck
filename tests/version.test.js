import test from 'node:test';
import assert from 'node:assert/strict';
import { APP_VERSION, BUILD_ID } from '../src/version.js';
import { APP_VERSION as CONFIG_APP_VERSION, BUILD_ID as CONFIG_BUILD_ID, AUTH_ENABLED } from '../src/config.js';

test('version.js exporta APP_VERSION y BUILD_ID válidos', () => {
  assert.ok(typeof APP_VERSION === 'string' && APP_VERSION.length > 0);
  assert.ok(typeof BUILD_ID === 'string' && BUILD_ID.length > 0);
});

test('config.js re-exporta la misma APP_VERSION y BUILD_ID', () => {
  assert.equal(CONFIG_APP_VERSION, APP_VERSION);
  assert.equal(CONFIG_BUILD_ID, BUILD_ID);
  assert.equal(typeof AUTH_ENABLED, 'boolean');
});
