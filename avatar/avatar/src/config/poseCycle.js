/**
 * A synthetic "Pose Cycle" catalog entry: a shuffled walk through a curated
 * pool of static poses (see src/lib/poseCycle.js for the shuffle/hold math),
 * appended to the custom-folder catalog rather than baked into the scanned
 * list itself.
 *
 * Deliberately resolved by *label*, not id: a custom folder's ids are a hash
 * of the absolute file path (see stageCommands.js/local-bus.md), so they're
 * fragile and only knowable after a scan. Matching on the label the file was
 * given means this never hardcodes one of those hashes.
 */

export const poseCycleId = 'pose-cycle';

// Curated from the Pose Library 02 poses picked out by hand, doubled with
// each one's Mirror variant for more variety without needing more assets.
export const poseCycleLabels = [
  'Pose 03', 'Pose 03 Mirror',
  'Pose 04', 'Pose 04 Mirror',
  'Pose 06', 'Pose 06 Mirror',
  'Pose 07', 'Pose 07 Mirror',
  'Pose 08', 'Pose 08 Mirror',
  'Pose 09', 'Pose 09 Mirror',
  'Pose 11', 'Pose 11 Mirror',
  'Pose 13', 'Pose 13 Mirror',
  'Pose 14', 'Pose 14 Mirror',
];

// Longer than a Combo's blend: this one is ambient, so it should read as the
// avatar drifting between poses rather than performing a gesture.
export const poseCycleFadeSeconds = 0.95;
export const defaultPoseCycleHoldSeconds = 2;
export const minPoseCycleHoldSeconds = 0.75;
export const maxPoseCycleHoldSeconds = 8;

/** @param {unknown} value */
export function normalizePoseCycleHoldSeconds(value) {
  if (value == null) return defaultPoseCycleHoldSeconds;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return defaultPoseCycleHoldSeconds;
  return Math.min(maxPoseCycleHoldSeconds, Math.max(minPoseCycleHoldSeconds, numeric));
}

/**
 * @param {{ id: string, label: string }[]} libraryAnimations - the raw scan
 *   result, i.e. what a custom animations folder actually contains right now.
 * @returns {import('./animationLookup').AnimationEntry | null} `null` when
 *   fewer than 2 of the curated poses are present — a cycle needs at least
 *   two to alternate between.
 */
export function buildPoseCycleEntry(libraryAnimations) {
  const byLabel = new Map(libraryAnimations.map((entry) => [entry.label, entry.id]));
  const poseIds = poseCycleLabels.map((label) => byLabel.get(label)).filter(Boolean);
  if (poseIds.length < 2) return null;

  return {
    id: poseCycleId,
    label: 'Pose Cycle',
    source: 'pose-cycle',
    poseIds,
    group: 'Combos',
    selectable: true,
  };
}
