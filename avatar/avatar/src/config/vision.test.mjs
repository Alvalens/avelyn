import assert from 'node:assert/strict';
import test from 'node:test';
import { createDefaultVision, normalizeVision } from './vision.js';

test('defaults: everything on', () => {
  assert.deepEqual(createDefaultVision(), { enabled: true, initiative: true, lookOnItsOwn: true });
  assert.deepEqual(normalizeVision(undefined), createDefaultVision());
  assert.deepEqual(normalizeVision('yes'), createDefaultVision());
});

test('each toggle is on unless it is exactly false', () => {
  assert.equal(normalizeVision({ enabled: 'false' }).enabled, true);
  assert.equal(normalizeVision({ enabled: false }).enabled, false);
  assert.equal(normalizeVision({ initiative: false }).initiative, false);
  assert.equal(normalizeVision({ lookOnItsOwn: false }).lookOnItsOwn, false);
});

test('hand-edited knobs survive a save from Settings', () => {
  const raw = {
    initiative: true,
    minGapMinutes: [10, 15],
    quietMinutes: 5,
    retryGapMinutes: 3,
    keep: 20,
    blocklist: ['secret thing'],
  };
  const out = normalizeVision(raw);
  assert.deepEqual(out.minGapMinutes, [10, 15]);
  assert.equal(out.quietMinutes, 5);
  assert.equal(out.retryGapMinutes, 3);
  assert.equal(out.keep, 20);
  assert.deepEqual(out.blocklist, ['secret thing']);
});

test('knobs that were never written are not invented', () => {
  const out = normalizeVision({});
  assert.equal('blocklist' in out, false);
  assert.equal('keep' in out, false);
});
