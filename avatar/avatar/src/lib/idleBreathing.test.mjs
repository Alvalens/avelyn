import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeIdleBreathing,
  eyePitchWaves,
  eyeYawWaves,
  headPitchWaves,
  headYawWaves,
  idleBreathingChestScaleAmplitude,
  idleBreathingRateHz,
} from './idleBreathing.js';

function sumWavesAt(t, waves) {
  return waves.reduce((total, { rateHz, amplitude, phase = 0 }) => {
    return total + Math.sin(t * rateHz * Math.PI * 2 + phase) * amplitude;
  }, 0);
}

test('zero intensity yields no motion at all, regardless of time', () => {
  for (const t of [0, 1.3, 100]) {
    assert.deepEqual(computeIdleBreathing(t, 0), {
      chestScale: 1,
      headYaw: 0,
      headPitch: 0,
      eyeYaw: 0,
      eyePitch: 0,
    });
  }
});

test('chest scale is 1 at t=0 and peaks at a quarter period', () => {
  assert.equal(computeIdleBreathing(0, 1).chestScale, 1);

  const quarterPeriod = 1 / idleBreathingRateHz / 4;
  const atPeak = computeIdleBreathing(quarterPeriod, 1).chestScale;
  assert.ok(Math.abs(atPeak - (1 + idleBreathingChestScaleAmplitude)) < 1e-9);
});

test('head and eye channels match the sum of their configured waves', () => {
  const t = 12.34;
  const motion = computeIdleBreathing(t, 1);
  assert.ok(Math.abs(motion.headYaw - sumWavesAt(t, headYawWaves)) < 1e-9);
  assert.ok(Math.abs(motion.headPitch - sumWavesAt(t, headPitchWaves)) < 1e-9);
  assert.ok(Math.abs(motion.eyeYaw - sumWavesAt(t, eyeYawWaves)) < 1e-9);
  assert.ok(Math.abs(motion.eyePitch - sumWavesAt(t, eyePitchWaves)) < 1e-9);
});

test('every channel scales linearly with intensity', () => {
  const t = 3.7;
  const full = computeIdleBreathing(t, 1);
  const half = computeIdleBreathing(t, 0.5);
  assert.ok(Math.abs((half.chestScale - 1) - (full.chestScale - 1) * 0.5) < 1e-9);
  assert.ok(Math.abs(half.headYaw - full.headYaw * 0.5) < 1e-9);
  assert.ok(Math.abs(half.headPitch - full.headPitch * 0.5) < 1e-9);
  assert.ok(Math.abs(half.eyeYaw - full.eyeYaw * 0.5) < 1e-9);
  assert.ok(Math.abs(half.eyePitch - full.eyePitch * 0.5) < 1e-9);
});

test('intensity is clamped defensively', () => {
  const t = 0.9;
  assert.deepEqual(computeIdleBreathing(t, 5), computeIdleBreathing(t, 1));
  assert.deepEqual(computeIdleBreathing(t, -3), computeIdleBreathing(t, 0));
});
