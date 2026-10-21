/**
 * Cubic-Bézier timing functions — the same curve CSS `cubic-bezier()` and
 * After Effects' keyframe easing describe, solved the same way (Newton-Raphson
 * with a bisection fallback, as browsers do it).
 *
 * The control points P0 (0,0) and P3 (1,1) are fixed; only P1 and P2 are given.
 * The curve is a *parametric* one, so x is not the parameter: the solver first
 * finds the t whose x equals the elapsed fraction, then reads y off that t.
 * Skipping that step and using the fraction as t directly is the usual way
 * these come out subtly wrong.
 */

const NEWTON_ITERATIONS = 8;
const NEWTON_MIN_SLOPE = 0.001;
const SUBDIVISION_EPSILON = 1e-7;
const SUBDIVISION_MAX_ITERATIONS = 12;

/** Polynomial coefficients for one axis of the curve. */
function coefficients(p1, p2) {
  const c = 3 * p1;
  const b = 3 * (p2 - p1) - c;
  return { a: 1 - c - b, b, c };
}

function sampleCurve({ a, b, c }, t) {
  return ((a * t + b) * t + c) * t;
}

function sampleSlope({ a, b, c }, t) {
  return (3 * a * t + 2 * b) * t + c;
}

/** @param {{a:number,b:number,c:number}} x */
function solveForT(x, target) {
  let t = target;

  for (let i = 0; i < NEWTON_ITERATIONS; i += 1) {
    const slope = sampleSlope(x, t);
    if (Math.abs(slope) < NEWTON_MIN_SLOPE) break;
    const error = sampleCurve(x, t) - target;
    if (Math.abs(error) < SUBDIVISION_EPSILON) return t;
    t -= error / slope;
  }

  // Newton can wander outside 0..1 on flat stretches of the curve; bisection
  // cannot, so it finishes the job.
  let low = 0;
  let high = 1;
  t = target;
  for (let i = 0; i < SUBDIVISION_MAX_ITERATIONS; i += 1) {
    const value = sampleCurve(x, t);
    if (Math.abs(value - target) < SUBDIVISION_EPSILON) break;
    if (value < target) low = t;
    else high = t;
    t = (low + high) / 2;
  }
  return t;
}

/**
 * @param {number} p1x
 * @param {number} p1y
 * @param {number} p2x
 * @param {number} p2y
 * @returns {(t: number) => number} eased 0..1, clamped at both ends
 */
export function cubicBezier(p1x, p1y, p2x, p2y) {
  // A straight line needs no solving, and the solver's slope guard is happiest
  // not being handed one.
  if (p1x === p1y && p2x === p2y) return (t) => Math.min(1, Math.max(0, t));

  const x = coefficients(p1x, p2x);
  const y = coefficients(p1y, p2y);

  return (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return sampleCurve(y, solveForT(x, t));
  };
}

/**
 * How one pose blends into the next.
 *
 * Leaves the old pose gently, covers most of the distance in the middle third,
 * then spends a long tail settling into the new one (≈0.09 of the way at 20%
 * of the time, ≈0.78 at 50%, ≈0.94 at 70%). Bodies accelerate into a movement
 * and decelerate out of it, and it is that long settle that reads as weight
 * rather than as a dissolve.
 *
 * Deliberately asymmetric — a symmetric ease-in-out like CSS's spends as long
 * arriving as it did leaving, which at this duration still lands abruptly.
 */
export const poseBlendEase = cubicBezier(0.5, 0, 0.15, 1);

/** Gentler and symmetric, for easing a clip away to the bind pose. */
export const fadeOutEase = cubicBezier(0.4, 0, 0.6, 1);
