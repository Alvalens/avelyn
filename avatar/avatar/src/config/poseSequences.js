/**
 * Named, ordered combinations of static poses — e.g. `shy_flustered` is
 * "touch chest, clasp hands, fidget with collar," not one raw pose held on
 * loop. Unlike Pose Cycle (src/config/poseCycle.js — shuffled, ambient,
 * never finishes), these are deliberate, fixed-order, and finite: they play
 * once as a gesture and hold on the last pose, exactly like a real one-shot
 * VRMA clip does — see the `pose-sequence` branch in VrmAvatar.jsx's overlay
 * handling and `playPoseSequence` in useVrmAnimation.js.
 *
 * Each definition gets a permanent, hand-chosen `id` (not a hash of a file
 * path) specifically so `bridge/src/actions.ts` can reference it directly
 * without the "re-derive the id if the folder changes" fragility that
 * hash-based library ids have.
 */

// How long a pose stays up, and how long the eased blend into it takes.
// `holdSeconds` only applies at the two ends of a combo — the entry into the
// first pose and the settle on the last one (see the `stepHold` helper in
// `playPoseSequence`, useVrmAnimation.js) — since those are what should carry
// the same weight and are the only stops meant to actually be felt. Anything
// in between only gets `fadeSeconds`, just enough for its own crossfade, so a
// 3+ pose combo flows through its middle poses instead of freezing on each.
export const poseSequenceHoldSeconds = 1.15;
export const poseSequenceFadeSeconds = 0.7;

export const poseSequenceDefinitions = [
  {
    id: 'combo-shy-flustered',
    label: 'Combo Shy Flustered',
    poseLabels: ['Pose 06', 'Pose 13', 'Pose 14'],
  },
  {
    id: 'combo-think',
    label: 'Combo Think',
    poseLabels: ['Pose 04', 'Pose 11'],
  },
  {
    id: 'combo-laugh',
    label: 'Combo Laugh',
    poseLabels: ['Pose 08', 'Pose 09'],
  },
  {
    id: 'combo-tsun-deny',
    label: 'Combo Tsun Deny',
    poseLabels: ['Pose 04', 'Pose 07'],
  },
  {
    id: 'combo-idle-calm',
    label: 'Combo Idle Calm',
    poseLabels: ['Pose 04'],
  },
  {
    id: 'combo-listening',
    label: 'Combo Listening',
    poseLabels: ['Pose 03'],
  },
  {
    id: 'combo-pleased',
    label: 'Combo Pleased',
    poseLabels: ['Pose 12', 'Pose 15'],
  },
];

/**
 * Resolves every definition's pose labels against whatever a custom
 * animations folder actually scanned in right now. A definition with none of
 * its poses present is dropped rather than emitted with an empty `poseIds`.
 * @param {{ id: string, label: string }[]} libraryAnimations
 * @returns {import('./animationLookup').AnimationEntry[]}
 */
export function buildPoseSequenceEntries(libraryAnimations) {
  const byLabel = new Map(libraryAnimations.map((entry) => [entry.label, entry.id]));

  return poseSequenceDefinitions
    .map((def) => {
      const poseIds = def.poseLabels.map((label) => byLabel.get(label)).filter(Boolean);
      if (poseIds.length === 0) return null;

      return {
        id: def.id,
        label: def.label,
        source: 'pose-sequence',
        poseIds,
        holdSeconds: poseSequenceHoldSeconds,
        fadeSeconds: poseSequenceFadeSeconds,
        group: 'Combos',
        selectable: true,
      };
    })
    .filter(Boolean);
}
