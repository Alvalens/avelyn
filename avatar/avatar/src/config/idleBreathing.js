export const defaultIdleBreathingIntensity = 0.6;
export const minIdleBreathingIntensity = 0;
export const maxIdleBreathingIntensity = 1;

/** @param {unknown} value */
export function normalizeIdleBreathingIntensity(value) {
  if (value == null) return defaultIdleBreathingIntensity;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return defaultIdleBreathingIntensity;
  return Math.min(maxIdleBreathingIntensity, Math.max(minIdleBreathingIntensity, numeric));
}
