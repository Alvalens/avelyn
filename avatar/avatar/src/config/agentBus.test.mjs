import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createDefaultAgentBus,
  defaultAgentBusPort,
  normalizeAgentBus,
  normalizeAgentBusPort,
} from './agentBus.js';

test('normalizeAgentBus reads a section it wrote', () => {
  const settings = { enabled: true, port: 51000, requireToken: false };
  assert.deepEqual(normalizeAgentBus(settings), settings);
});

test('normalizeAgentBus turns the bus on unless a file turns it off', () => {
  // The whole section missing is the normal case for a config.yaml written
  // before the bus existed.
  assert.deepEqual(normalizeAgentBus(undefined), createDefaultAgentBus());
  assert.deepEqual(normalizeAgentBus(null), createDefaultAgentBus());
  assert.deepEqual(normalizeAgentBus('yes'), createDefaultAgentBus());
  assert.equal(normalizeAgentBus({}).enabled, true, 'on unless turned off — her engine needs it');
  assert.equal(normalizeAgentBus({ enabled: false }).enabled, false);
  // Only a real boolean closes it: 'false' from a hand-edited file does not.
  assert.equal(normalizeAgentBus({ enabled: 'false' }).enabled, true, 'only a real false turns it off');
});

test('normalizeAgentBus keeps the token on unless it is explicitly off', () => {
  assert.equal(normalizeAgentBus({}).requireToken, true);
  assert.equal(normalizeAgentBus({ requireToken: undefined }).requireToken, true);
  // A dropped key must not quietly unauthenticate the bus.
  assert.equal(normalizeAgentBus({ requireToken: 'no' }).requireToken, true);
  assert.equal(normalizeAgentBus({ requireToken: false }).requireToken, false);
});

test('normalizeAgentBusPort falls back rather than passing something unbindable on', () => {
  assert.equal(normalizeAgentBusPort(51000), 51000);
  assert.equal(normalizeAgentBusPort('51000'), 51000);
  assert.equal(normalizeAgentBusPort(1024), 1024);
  assert.equal(normalizeAgentBusPort(65535), 65535);

  // A privileged port, one past the end, a fraction, and the three shapes that
  // would otherwise reach `listen` as NaN — which it reads as "any free port",
  // moving the bus somewhere the copied curl example does not point.
  assert.equal(normalizeAgentBusPort(80), defaultAgentBusPort);
  assert.equal(normalizeAgentBusPort(65536), defaultAgentBusPort);
  assert.equal(normalizeAgentBusPort(47903.5), defaultAgentBusPort);
  assert.equal(normalizeAgentBusPort('nope'), defaultAgentBusPort);
  assert.equal(normalizeAgentBusPort(null), defaultAgentBusPort);
  assert.equal(normalizeAgentBusPort(undefined), defaultAgentBusPort);
});
