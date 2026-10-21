import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPoseCycleEntry,
  defaultPoseCycleHoldSeconds,
  maxPoseCycleHoldSeconds,
  minPoseCycleHoldSeconds,
  normalizePoseCycleHoldSeconds,
  poseCycleLabels,
} from './poseCycle.js';

test('buildPoseCycleEntry resolves curated labels against the live scan', () => {
  const libraryAnimations = poseCycleLabels.map((label, index) => ({
    id: `lib-anim-${index}`,
    label,
  }));

  const entry = buildPoseCycleEntry(libraryAnimations);

  assert.ok(entry);
  assert.equal(entry.id, 'pose-cycle');
  assert.equal(entry.source, 'pose-cycle');
  assert.equal(entry.selectable, true);
  assert.deepEqual(entry.poseIds, libraryAnimations.map((e) => e.id));
});

test('buildPoseCycleEntry drops labels the folder does not actually have', () => {
  const libraryAnimations = [
    { id: 'lib-anim-a', label: 'Pose 03' },
    { id: 'lib-anim-b', label: 'Pose 03 Mirror' },
    { id: 'lib-anim-c', label: 'Greeting' }, // not one of the curated labels
  ];

  const entry = buildPoseCycleEntry(libraryAnimations);

  assert.ok(entry);
  assert.deepEqual(entry.poseIds, ['lib-anim-a', 'lib-anim-b']);
});

test('buildPoseCycleEntry returns null when fewer than 2 curated poses are present', () => {
  assert.equal(buildPoseCycleEntry([]), null);
  assert.equal(buildPoseCycleEntry([{ id: 'lib-anim-a', label: 'Pose 03' }]), null);
});

test('normalizePoseCycleHoldSeconds clamps and defaults', () => {
  assert.equal(normalizePoseCycleHoldSeconds(3.5), 3.5);
  assert.equal(normalizePoseCycleHoldSeconds(0), minPoseCycleHoldSeconds);
  assert.equal(normalizePoseCycleHoldSeconds(100), maxPoseCycleHoldSeconds);
  assert.equal(normalizePoseCycleHoldSeconds(null), defaultPoseCycleHoldSeconds);
  assert.equal(normalizePoseCycleHoldSeconds('nope'), defaultPoseCycleHoldSeconds);
});
