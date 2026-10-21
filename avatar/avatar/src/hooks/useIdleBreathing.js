import { useCallback, useRef } from 'react';
import * as THREE from 'three';
import { computeIdleBreathing } from '../lib/idleBreathing';

const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const offsetQuatX = new THREE.Quaternion();
const offsetQuatY = new THREE.Quaternion();

/**
 * Avelyn's idle secondary motion: chest breathing, head sway, gaze wander.
 * One computed sample per frame, applied through two callbacks with
 * different timing requirements — see comments below and idleBreathing.js.
 *
 * @param {import('@pixiv/three-vrm').VRM | null} vrm
 * @param {number} intensity - 0..1
 */
export function useIdleBreathing(vrm, intensity = 0) {
  const elapsed = useRef(0);
  const motionRef = useRef({ chestScale: 1, headYaw: 0, headPitch: 0, eyeYaw: 0, eyePitch: 0 });

  // Gaze: VRMLookAt applies its yaw/pitch *inside* vrm.update(), so this
  // must run before it — setting these after would apply a frame late.
  // Safe to drive directly: this app never sets vrm.lookAt.target, so
  // VRMLookAt's own auto-update (which would otherwise overwrite yaw/pitch
  // from a target every frame) never fires.
  const updateGaze = useCallback(
    (delta) => {
      elapsed.current += delta;
      const motion = computeIdleBreathing(elapsed.current, intensity);
      motionRef.current = motion;

      const lookAt = vrm?.lookAt;
      if (lookAt) {
        lookAt.yaw = motion.eyeYaw;
        lookAt.pitch = motion.eyePitch;
      }
    },
    [vrm, intensity],
  );

  // Pose: chest/head are *raw* bone writes, and vrm.update() only copies
  // rotation (never scale) from the normalized rig to the raw one it
  // actually renders — so this must run after vrm.update() or it either
  // gets overwritten (rotation) or never read in the first place (scale).
  // Head is layered on top of whatever pose is currently active via
  // quaternion multiply (fresh each frame, never accumulated), same as
  // chest's scale is layered on top of the rest scale of 1.
  const updatePose = useCallback(() => {
    if (!vrm?.humanoid) return;
    const { chestScale, headYaw, headPitch } = motionRef.current;

    const chest = vrm.humanoid.getRawBoneNode('chest');
    if (chest) chest.scale.setScalar(chestScale);

    const head = vrm.humanoid.getRawBoneNode('head');
    if (head) {
      offsetQuatY.setFromAxisAngle(AXIS_Y, headYaw);
      offsetQuatX.setFromAxisAngle(AXIS_X, headPitch);
      head.quaternion.multiply(offsetQuatY).multiply(offsetQuatX);
    }
  }, [vrm]);

  return { updateGaze, updatePose };
}
