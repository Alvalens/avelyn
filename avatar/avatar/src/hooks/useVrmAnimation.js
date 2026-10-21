import { useCallback, useEffect, useRef } from 'react';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import {
  VRMAnimationLoaderPlugin,
  createVRMAnimationClip,
} from '@pixiv/three-vrm-animation';
import * as THREE from 'three';
import {
  configureAnimationAction,
  createCrossFade,
  createFadeOut,
} from '../lib/vrmAnimationAction';
import { jitterHoldSeconds, shuffle } from '../lib/poseCycle';

const DEFAULT_FADE = 0.65;
// The cache keys on url, and a custom animations folder mints fresh blob urls on
// every rescan — old keys can never be hit again, so the map needs a bound.
const CACHE_LIMIT = 24;

/**
 * @param {import('@pixiv/three-vrm').VRM | null} vrm
 */
export function useVrmAnimation(vrm) {
  const mixer = useRef(null);
  const currentAction = useRef(null);
  const cache = useRef(new Map());
  const requestGeneration = useRef(0);
  /** Pending "advance to the next pose" of a sequence or cycle. */
  const stepTimer = useRef(null);
  /** Pending "the fade to rest has finished" callback. */
  const fadeTimer = useRef(null);
  /** The eased blend in progress, ticked from `update` below. */
  const fade = useRef(null);

  useEffect(() => {
    if (!vrm) return undefined;

    const animationMixer = new THREE.AnimationMixer(vrm.scene);
    mixer.current = animationMixer;

    return () => {
      if (stepTimer.current) clearTimeout(stepTimer.current);
      if (fadeTimer.current) clearTimeout(fadeTimer.current);
      animationMixer.stopAllAction();
      mixer.current = null;
      currentAction.current = null;
      fade.current = null;
    };
  }, [vrm]);

  const loadAnimation = useCallback(async (url) => {
    const cached = cache.current.get(url);
    if (cached) return cached;

    const loader = new GLTFLoader();
    loader.register((parser) => new VRMAnimationLoaderPlugin(parser));
    const gltf = await loader.loadAsync(url);
    const animation = gltf.userData.vrmAnimations?.[0];
    if (!animation) throw new Error(`No VRM animation found in ${url}`);

    // Map iterates in insertion order, so the first key is the oldest.
    while (cache.current.size >= CACHE_LIMIT) {
      const oldest = cache.current.keys().next().value;
      if (oldest === undefined) break;
      cache.current.delete(oldest);
    }
    cache.current.set(url, animation);
    return animation;
  }, []);

  const clearTimers = useCallback(() => {
    if (stepTimer.current) {
      clearTimeout(stepTimer.current);
      stepTimer.current = null;
    }
    if (fadeTimer.current) {
      clearTimeout(fadeTimer.current);
      fadeTimer.current = null;
    }
  }, []);

  /**
   * Retire the in-flight request and any pending sequence step **without
   * touching what is on screen**.
   *
   * This is what effect cleanups use. `cancel` below hard-stops the action,
   * which drops the avatar into the bind pose instantly — and since the
   * replacement clip is loaded asynchronously, that left a visible T-pose for
   * the whole length of the load on every selection change. Leaving the pose
   * standing means the incoming `play` has something to crossfade *from*.
   */
  const cancelPending = useCallback(() => {
    requestGeneration.current += 1;
    clearTimers();
  }, [clearTimers]);

  const stop = useCallback(
    (fadeSeconds = DEFAULT_FADE, onSettled) => {
      clearTimers();

      const action = currentAction.current;
      if (!action) {
        onSettled?.();
        return;
      }

      fade.current?.finish();
      fade.current = createFadeOut(action, fadeSeconds);
      currentAction.current = null;

      if (onSettled) {
        fadeTimer.current = setTimeout(onSettled, fadeSeconds * 1000 + 20);
      }
    },
    [clearTimers],
  );

  const play = useCallback(
    async (url, playback = 'loop', onComplete, sequenceGeneration, fadeSeconds = DEFAULT_FADE) => {
      if (!vrm || !mixer.current || !url) {
        stop(undefined, onComplete);
        return;
      }

      const generation = sequenceGeneration ?? ++requestGeneration.current;

      try {
        const animation = await loadAnimation(url);
        if (generation !== requestGeneration.current || !mixer.current) return;

        const action = mixer.current.clipAction(createVRMAnimationClip(animation, vrm));
        action.reset();
        configureAnimationAction(action, playback);

        if (playback === 'once' && onComplete) {
          const handleFinished = ({ action: finishedAction }) => {
            if (finishedAction !== action) return;
            // Detach first: a superseded generation used to return early and
            // leave its closure on the mixer for the life of the VRM, which a
            // hotkey interrupting a gesture can now do on every key press.
            mixer.current?.removeEventListener('finished', handleFinished);
            if (generation !== requestGeneration.current) return;
            onComplete();
          };
          mixer.current.addEventListener('finished', handleFinished);
        }

        action.play();
        // Settle whatever blend was still running, so its outgoing action does
        // not keep claiming weight once it is two clips behind.
        fade.current?.finish();
        fade.current = createCrossFade(currentAction.current, action, fadeSeconds);
        currentAction.current = action;
      } catch (error) {
        console.warn('[avatar] VRMA load failed', error);
        if (generation === requestGeneration.current) {
          onComplete?.();
        }
      }
    },
    [loadAnimation, stop, vrm],
  );

  /** Hard stop, for teardown — see `cancelPending` for the gentle version. */
  const cancel = useCallback(() => {
    requestGeneration.current += 1;
    clearTimers();
    fade.current = null;
    currentAction.current?.stop();
    currentAction.current = null;
  }, [clearTimers]);

  const playSequence = useCallback(
    (introIds, loopIds, resolveUrl) => {
      if (!vrm || !mixer.current) return cancelPending;

      const generation = ++requestGeneration.current;
      const introUrls = introIds.map(resolveUrl).filter(Boolean);
      const loopUrls = loopIds.map(resolveUrl).filter(Boolean);
      if (introUrls.length === 0 && loopUrls.length === 0) return cancelPending;

      const playStep = (urls, index, onFinished) => {
        if (generation !== requestGeneration.current) return;
        if (index >= urls.length) {
          onFinished?.();
          return;
        }

        void play(
          urls[index],
          'once',
          () => {
            if (generation !== requestGeneration.current) return;
            playStep(urls, index + 1, onFinished);
          },
          generation,
        );
      };

      const runLoop = () => {
        if (generation !== requestGeneration.current || loopUrls.length === 0) return;
        playStep(loopUrls, 0, runLoop);
      };

      playStep(introUrls, 0, runLoop);
      return cancelPending;
    },
    [cancelPending, play, vrm],
  );

  // A named, ordered, *finite* combination of static poses — a gesture, not
  // an idle. Plays each pose "once" (clamped, so it holds), waits a fixed
  // hold, advances; the final pose holds indefinitely once reached, and
  // `onComplete` fires then, mirroring how a real one-shot VRMA's `finished`
  // event signals a gesture is over (see the `pose-sequence` branch in
  // VrmAvatar.jsx's motionOverlay effect, which calls `onMotionOverlayEnd`
  // from this same callback).
  const playPoseSequence = useCallback(
    (poseIds, holdSeconds, resolveUrl, onComplete, fadeSeconds = DEFAULT_FADE) => {
      if (!vrm || !mixer.current) {
        onComplete?.();
        return cancelPending;
      }

      const generation = ++requestGeneration.current;
      const urls = poseIds.map(resolveUrl).filter(Boolean);
      if (urls.length === 0) {
        onComplete?.();
        return cancelPending;
      }

      // Only the entry into the first pose and the settle on the last pose
      // hold for the full `holdSeconds` — matching those two is what makes a
      // combo read as one deliberate gesture with the same weight at both
      // ends, rather than a strong opener that trails off into something
      // limper. Interior poses are connective tissue: they get just long
      // enough for their own crossfade to finish before the next one starts,
      // so a 3+ pose combo flows through the middle instead of freezing on
      // every stop along the way.
      const lastIndex = urls.length - 1;
      const stepHold = (index) => (index === 0 || index === lastIndex ? holdSeconds : fadeSeconds);

      const playStep = (index) => {
        if (generation !== requestGeneration.current) return;
        if (index >= urls.length) {
          onComplete?.();
          return;
        }

        void play(urls[index], 'once', undefined, generation, fadeSeconds);

        stepTimer.current = setTimeout(() => {
          if (generation !== requestGeneration.current) return;
          playStep(index + 1);
        }, stepHold(index) * 1000);
      };

      playStep(0);

      return cancelPending;
    },
    [cancelPending, play, vrm],
  );

  // A slow, endless walk through a curated pool of static poses: play each
  // one "once" (which — because configureAnimationAction sets
  // clampWhenFinished for 'once' — holds at its single keyframe indefinitely
  // rather than reverting), hold for a jittered duration, then crossfade to
  // the next. Reshuffles every time it completes a full pass so the order
  // never repeats, without ever playing the same pose twice in a row.
  const playPoseCycle = useCallback(
    (poseIds, holdSeconds, resolveUrl, fadeSeconds = DEFAULT_FADE) => {
      if (!vrm || !mixer.current) return cancelPending;

      const generation = ++requestGeneration.current;
      const baseUrls = poseIds.map(resolveUrl).filter(Boolean);
      if (baseUrls.length === 0) return cancelPending;

      let order = shuffle(baseUrls);
      let index = 0;

      const playCurrent = () => {
        if (generation !== requestGeneration.current) return;
        if (index >= order.length) {
          order = shuffle(baseUrls);
          index = 0;
        }

        void play(order[index], 'once', undefined, generation, fadeSeconds);

        const holdMs = jitterHoldSeconds(holdSeconds) * 1000;
        stepTimer.current = setTimeout(() => {
          if (generation !== requestGeneration.current) return;
          index += 1;
          playCurrent();
        }, holdMs);
      };

      playCurrent();

      return cancelPending;
    },
    [cancelPending, play, vrm],
  );

  const returnToRest = useCallback(() => {
    stop(DEFAULT_FADE);
  }, [stop]);

  const update = useCallback((delta) => {
    // Before the mixer: it reads the weights this sets while it composes the
    // frame, so advancing the blend afterwards would always be a frame late.
    if (fade.current?.advance(delta)) {
      fade.current = null;
    }
    mixer.current?.update(delta);
  }, []);

  return {
    play,
    playSequence,
    playPoseSequence,
    playPoseCycle,
    cancel,
    cancelPending,
    stop,
    returnToRest,
    update,
    isPlaying: () => Boolean(currentAction.current),
  };
}
