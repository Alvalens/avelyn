import * as THREE from 'three';
// Extension included deliberately: this module is loaded by `node --test`,
// which does not do Vite's extensionless resolution.
import { fadeOutEase, poseBlendEase } from './easing.js';

/** @typedef {'loop' | 'once'} AnimationPlayback */

/**
 * @param {THREE.AnimationAction} action
 * @param {AnimationPlayback} playback
 */
export function configureAnimationAction(action, playback) {
  if (playback === 'once') {
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
  } else {
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.clampWhenFinished = false;
  }
  return action;
}

/**
 * Blend `previous` into `next` over `durationSeconds` on a cubic-Bézier curve
 * (see ./easing.js), driving both weights ourselves so they sum to 1 for the
 * whole blend.
 *
 * THREE's own `fadeIn`/`fadeOut` ramp weight linearly, which is what made
 * pose-to-pose blends read as mechanical: the movement starts and stops at
 * full speed, with no acceleration into it or settle out of it.
 *
 * That sum is not just tidiness. Three.js fills whatever weight a clip does
 * not claim with the **bind pose**, so a blend that dips below 1 shows a ghost
 * of the T-pose through the middle of it — and a `fadeIn` with nothing to fade
 * *from* claims 0 weight at the start, which is a full-strength T-pose
 * dissolving into the clip. Snapping to full weight when there is no outgoing
 * action is what fixes that: nothing precedes it, so there is no jump to see.
 *
 * @param {THREE.AnimationAction | null} previous
 * @param {THREE.AnimationAction} next
 * @param {number} durationSeconds
 * @param {(t: number) => number} [ease]
 * @returns {{ advance: (delta: number) => boolean, finish: () => void }}
 */
export function createCrossFade(previous, next, durationSeconds, ease = poseBlendEase) {
  const duration = Math.max(0, durationSeconds);
  const outgoing = previous && previous !== next ? previous : null;

  const apply = (k) => {
    next.setEffectiveWeight(k);
    if (outgoing) outgoing.setEffectiveWeight(1 - k);
  };

  const settle = () => {
    apply(1);
    outgoing?.stop();
  };

  if (!outgoing || duration === 0) {
    settle();
    return { advance: () => true, finish: () => {} };
  }

  apply(0);
  let elapsed = 0;

  return {
    advance(delta) {
      elapsed += delta;
      if (elapsed >= duration) {
        settle();
        return true;
      }
      apply(ease(elapsed / duration));
      return false;
    },
    finish: settle,
  };
}

/**
 * Ease one action down to nothing — deliberately *toward* the bind pose, which
 * is what "Rest" means. The only place the T-pose is the intended destination.
 *
 * @param {THREE.AnimationAction} action
 * @param {number} durationSeconds
 * @param {(t: number) => number} [ease]
 * @returns {{ advance: (delta: number) => boolean, finish: () => void }}
 */
export function createFadeOut(action, durationSeconds, ease = fadeOutEase) {
  const duration = Math.max(0, durationSeconds);

  const settle = () => {
    action.setEffectiveWeight(0);
    action.stop();
  };

  if (duration === 0) {
    settle();
    return { advance: () => true, finish: () => {} };
  }

  let elapsed = 0;

  return {
    advance(delta) {
      elapsed += delta;
      if (elapsed >= duration) {
        settle();
        return true;
      }
      action.setEffectiveWeight(1 - ease(elapsed / duration));
      return false;
    },
    finish: settle,
  };
}
