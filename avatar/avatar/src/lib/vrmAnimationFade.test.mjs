import assert from 'node:assert/strict';
import test from 'node:test';

import { createCrossFade, createFadeOut } from './vrmAnimationAction.js';

/** Minimal stand-in for THREE.AnimationAction — only weight and stop matter here. */
function fakeAction(name) {
  return {
    name,
    weight: 0,
    stopped: false,
    setEffectiveWeight(value) {
      this.weight = value;
      return this;
    },
    stop() {
      this.stopped = true;
      return this;
    },
  };
}

test('with nothing to fade from, the incoming clip snaps to full weight', () => {
  const next = fakeAction('next');
  const fade = createCrossFade(null, next, 0.5);

  // This is the T-pose fix: a fadeIn from nothing would start at weight 0,
  // and three.js fills the unclaimed weight with the bind pose.
  assert.equal(next.weight, 1);
  assert.equal(fade.advance(0.016), true, 'nothing left to do');
});

test('weights sum to 1 for the whole crossfade, so the bind pose never shows', () => {
  const previous = fakeAction('previous');
  const next = fakeAction('next');
  const fade = createCrossFade(previous, next, 1);

  assert.equal(next.weight, 0);
  assert.equal(previous.weight, 1);

  let elapsed = 0;
  let done = false;
  while (!done && elapsed < 2) {
    done = fade.advance(0.1);
    elapsed += 0.1;
    assert.ok(
      Math.abs(previous.weight + next.weight - 1) < 1e-9,
      `weights summed to ${previous.weight + next.weight} at t=${elapsed}`,
    );
  }

  assert.ok(done);
  assert.equal(next.weight, 1);
  assert.ok(previous.stopped, 'outgoing action released once it is at zero');
});

test('the crossfade follows the eased curve, not a straight line', () => {
  const next = fakeAction('next');
  const fade = createCrossFade(fakeAction('previous'), next, 1);

  fade.advance(0.25);
  assert.ok(next.weight < 0.25, 'still easing in a quarter of the way through');
  fade.advance(0.5);
  assert.ok(next.weight > 0.75, 'past the midpoint it has caught up');
});

test('a zero-length crossfade settles immediately', () => {
  const previous = fakeAction('previous');
  const next = fakeAction('next');
  const fade = createCrossFade(previous, next, 0);

  assert.equal(next.weight, 1);
  assert.equal(previous.weight, 0);
  assert.ok(previous.stopped);
  assert.equal(fade.advance(0.016), true);
});

test('crossfading an action with itself is a no-op, not a fade to nothing', () => {
  const action = fakeAction('same');
  createCrossFade(action, action, 0.5);

  assert.equal(action.weight, 1);
  assert.ok(!action.stopped);
});

test('finish settles a crossfade early, so an interrupted blend leaves no stale weight', () => {
  const previous = fakeAction('previous');
  const next = fakeAction('next');
  const fade = createCrossFade(previous, next, 1);

  fade.advance(0.2);
  fade.finish();

  assert.equal(next.weight, 1);
  assert.equal(previous.weight, 0);
  assert.ok(previous.stopped);
});

test('fadeOut eases down to zero and releases the action', () => {
  const action = fakeAction('going');
  action.setEffectiveWeight(1);
  const fade = createFadeOut(action, 1);

  assert.equal(fade.advance(0.25), false);
  assert.ok(action.weight > 0 && action.weight < 1);
  assert.ok(!action.stopped);

  assert.equal(fade.advance(1), true);
  assert.equal(action.weight, 0);
  assert.ok(action.stopped);
});
