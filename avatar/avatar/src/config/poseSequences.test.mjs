import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPoseSequenceEntries, poseSequenceDefinitions } from './poseSequences.js';

function fakeLibrary(labels) {
  return labels.map((label, index) => ({ id: `lib-anim-${index}`, label }));
}

test('buildPoseSequenceEntries resolves every definition when all poses are present', () => {
  const allLabels = [...new Set(poseSequenceDefinitions.flatMap((def) => def.poseLabels))];
  const library = fakeLibrary(allLabels);

  const entries = buildPoseSequenceEntries(library);

  assert.equal(entries.length, poseSequenceDefinitions.length);
  for (const entry of entries) {
    assert.equal(entry.source, 'pose-sequence');
    assert.equal(entry.selectable, true);
    assert.ok(entry.poseIds.length > 0);
    assert.ok(entry.holdSeconds > 0);
  }
});

test('buildPoseSequenceEntries drops a definition with none of its poses present', () => {
  const entries = buildPoseSequenceEntries(fakeLibrary(['Greeting', 'Squat']));
  assert.deepEqual(entries, []);
});

test('buildPoseSequenceEntries keeps a partial match rather than dropping it', () => {
  // combo-shy-flustered wants Pose 06/13/14 — give it only one of the three.
  const entries = buildPoseSequenceEntries(fakeLibrary(['Pose 06']));
  const shy = entries.find((e) => e.id === 'combo-shy-flustered');
  assert.ok(shy);
  assert.equal(shy.poseIds.length, 1);
});

test('every combo id is unique', () => {
  const ids = poseSequenceDefinitions.map((def) => def.id);
  assert.equal(new Set(ids).size, ids.length);
});
