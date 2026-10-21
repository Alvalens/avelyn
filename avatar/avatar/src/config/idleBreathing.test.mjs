import assert from 'node:assert/strict';
import test from 'node:test';
import {
  defaultIdleBreathingIntensity,
  maxIdleBreathingIntensity,
  minIdleBreathingIntensity,
  normalizeIdleBreathingIntensity,
} from './idleBreathing.js';

test('normalizeIdleBreathingIntensity keeps supported values', () => {
  assert.equal(normalizeIdleBreathingIntensity(0), 0);
  assert.equal(normalizeIdleBreathingIntensity(0.6), 0.6);
  assert.equal(normalizeIdleBreathingIntensity('0.4'), 0.4);
  assert.equal(normalizeIdleBreathingIntensity(1), 1);
});

test('normalizeIdleBreathingIntensity clamps out-of-range values', () => {
  assert.equal(normalizeIdleBreathingIntensity(-1), minIdleBreathingIntensity);
  assert.equal(normalizeIdleBreathingIntensity(5), maxIdleBreathingIntensity);
});

test('normalizeIdleBreathingIntensity falls back to the default for invalid input', () => {
  assert.equal(normalizeIdleBreathingIntensity(null), defaultIdleBreathingIntensity);
  assert.equal(normalizeIdleBreathingIntensity(undefined), defaultIdleBreathingIntensity);
  assert.equal(normalizeIdleBreathingIntensity('nope'), defaultIdleBreathingIntensity);
});
