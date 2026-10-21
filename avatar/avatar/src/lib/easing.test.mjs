import assert from 'node:assert/strict';
import test from 'node:test';

import { cubicBezier, fadeOutEase, poseBlendEase } from './easing.js';

/** Linear reference: `cubic-bezier(0, 0, 1, 1)` is the identity curve. */
const linear = cubicBezier(0, 0, 1, 1);

test('every curve is pinned at both ends and clamps beyond them', () => {
  for (const ease of [linear, poseBlendEase, fadeOutEase, cubicBezier(0.42, 0, 0.58, 1)]) {
    assert.equal(ease(0), 0);
    assert.equal(ease(1), 1);
    assert.equal(ease(-0.5), 0);
    assert.equal(ease(1.5), 1);
  }
});

test('the linear curve is the identity, to within solver tolerance', () => {
  for (const t of [0.1, 0.25, 0.5, 0.75, 0.9]) {
    assert.ok(Math.abs(linear(t) - t) < 1e-6, `linear(${t}) = ${linear(t)}`);
  }
});

test('matches values a browser produces for a known CSS curve', () => {
  // ease-in-out, i.e. cubic-bezier(0.42, 0, 0.58, 1).
  const easeInOut = cubicBezier(0.42, 0, 0.58, 1);
  const expected = [
    [0.25, 0.1290], // reference values from the same curve in CSS
    [0.5, 0.5],
    [0.75, 0.8710],
  ];

  for (const [t, want] of expected) {
    assert.ok(
      Math.abs(easeInOut(t) - want) < 1e-3,
      `easeInOut(${t}) = ${easeInOut(t)}, wanted ~${want}`,
    );
  }
});

test('every curve rises monotonically — a blend must never run backwards', () => {
  for (const ease of [poseBlendEase, fadeOutEase]) {
    let previous = 0;
    for (let i = 1; i <= 200; i += 1) {
      const value = ease(i / 200);
      assert.ok(value >= previous, `dipped at t=${i / 200}: ${value} < ${previous}`);
      previous = value;
    }
  }
});

test('the pose blend eases out of the old pose and settles long into the new one', () => {
  // Barely moving early — accelerating out of the pose, not jumping off it.
  assert.ok(poseBlendEase(0.2) < 0.12, `got ${poseBlendEase(0.2)}`);
  // Most of the distance is covered by the halfway point...
  assert.ok(poseBlendEase(0.5) > 0.7, `got ${poseBlendEase(0.5)}`);
  // ...leaving a long, slow settle rather than an abrupt arrival.
  assert.ok(poseBlendEase(0.7) > 0.9, `got ${poseBlendEase(0.7)}`);
  assert.ok(poseBlendEase(0.9) > 0.98, `got ${poseBlendEase(0.9)}`);
});

test('a curve with a flat stretch still solves, rather than diverging', () => {
  // Near-zero slope at the start is where Newton-Raphson alone gives up and
  // the bisection fallback has to finish.
  const stubborn = cubicBezier(1, 0, 0, 1);
  for (let i = 0; i <= 20; i += 1) {
    const value = stubborn(i / 20);
    assert.ok(Number.isFinite(value), `t=${i / 20} produced ${value}`);
    assert.ok(value >= 0 && value <= 1, `t=${i / 20} left 0..1: ${value}`);
  }
});
