// Pure math for Avelyn's idle secondary motion: a chest-scale breathing
// pulse, a small multi-frequency head sway, and an equally small gaze wander.
// Everything here is a *freshly recomputed offset from an absolute clock*,
// never an accumulated delta — the caller (useIdleBreathing.js) must track
// elapsed time itself and re-derive the offset every frame, so nothing here
// can drift. Kept free of THREE/VRM imports so `node --test` can load it.
//
// Two deliberate design choices, both learned the hard way from earlier
// attempts:
// - Chest is SCALE, not rotation. Chest is high in the humanoid bone
//   hierarchy, so rotating it swings everything above it (shoulders, arms,
//   head) as one rigid pivot — it read as the whole upper body rocking, not
//   breathing. Scaling it in place avoids that entirely.
// - Head/eye motion is a SUM of a few non-matching frequencies, not one
//   clean sine. A single sine reads as an obviously mechanical pulse; a few
//   summed waves at different, non-harmonic rates looks like organic drift.

function sumWaves(t, waves) {
  let total = 0;
  for (const { rateHz, amplitude, phase = 0 } of waves) {
    total += Math.sin(t * rateHz * Math.PI * 2 + phase) * amplitude;
  }
  return total;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

// ~17 breaths/minute — slow enough to read as calm, not panting.
export const idleBreathingRateHz = 0.28;
// ~1.2% size pulse at full intensity — enough to read as breathing up close,
// small enough that it's not a visible size change from a normal distance.
export const idleBreathingChestScaleAmplitude = 0.012;

// Radians. Two non-harmonic rates each, so the drift never quite repeats.
export const headYawWaves = [
  { rateHz: 0.09, amplitude: 0.025 },
  { rateHz: 0.13, amplitude: 0.015, phase: 1.7 },
];
export const headPitchWaves = [
  { rateHz: 0.07, amplitude: 0.020, phase: 0.9 },
  { rateHz: 0.15, amplitude: 0.012, phase: 2.4 },
];

// Degrees — but this model's VRMLookAt rangeMap compresses input degrees
// down a lot before it reaches the actual eye bones (e.g. a 90° input maps
// to only an 8° output horizontally), so these look large on paper but
// produce a modest, natural glance once mapped through.
export const eyeYawWaves = [
  { rateHz: 0.05, amplitude: 18, phase: 0.4 },
  { rateHz: 0.08, amplitude: 10, phase: 3.0 },
];
export const eyePitchWaves = [
  { rateHz: 0.04, amplitude: 12, phase: 1.2 },
  { rateHz: 0.11, amplitude: 6, phase: 0.2 },
];

/**
 * @param {number} elapsedSeconds - an absolute, monotonically increasing clock.
 * @param {number} intensity - 0..1, clamped defensively here too.
 */
export function computeIdleBreathing(elapsedSeconds, intensity) {
  const amount = clamp01(intensity);
  if (amount === 0) {
    return { chestScale: 1, headYaw: 0, headPitch: 0, eyeYaw: 0, eyePitch: 0 };
  }

  const chestPhase = elapsedSeconds * idleBreathingRateHz * Math.PI * 2;
  const chestScale = 1 + Math.sin(chestPhase) * idleBreathingChestScaleAmplitude * amount;

  return {
    chestScale,
    headYaw: sumWaves(elapsedSeconds, headYawWaves) * amount,
    headPitch: sumWaves(elapsedSeconds, headPitchWaves) * amount,
    eyeYaw: sumWaves(elapsedSeconds, eyeYawWaves) * amount,
    eyePitch: sumWaves(elapsedSeconds, eyePitchWaves) * amount,
  };
}
