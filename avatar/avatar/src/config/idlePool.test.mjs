import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isIdleAnimation,
  maxIdlePoolSize,
  normalizeIdlePool,
  pickIdleAnimation,
  toggleIdlePool,
} from './idlePool.js';

test('normalize drops non-strings, blanks and duplicates, and keeps order', () => {
  assert.deepEqual(
    normalizeIdlePool(['b', 'a', 'b', '  ', 42, null, ' c ']),
    ['b', 'a', 'c'],
  );
  assert.deepEqual(normalizeIdlePool('not-an-array'), []);
  assert.deepEqual(normalizeIdlePool(undefined), []);
});

test('normalize caps the pool', () => {
  const tooMany = Array.from({ length: maxIdlePoolSize + 5 }, (_, i) => `id-${i}`);
  assert.equal(normalizeIdlePool(tooMany).length, maxIdlePoolSize);
});

test('toggle adds then removes, without mutating the pool it was given', () => {
  const pool = ['a'];
  const added = toggleIdlePool(pool, 'b');

  assert.deepEqual(added, ['a', 'b']);
  assert.deepEqual(pool, ['a'], 'input pool untouched');
  assert.deepEqual(toggleIdlePool(added, 'b'), ['a']);
  assert.ok(isIdleAnimation(added, 'b'));
  assert.ok(!isIdleAnimation(pool, 'b'));
});

test('toggle ignores a blank id rather than storing one', () => {
  assert.deepEqual(toggleIdlePool(['a'], '   '), ['a']);
});

test('an empty pool picks nothing — which is what keeps the old behaviour', () => {
  assert.equal(pickIdleAnimation([], null), null);
  assert.equal(pickIdleAnimation([], 'anything'), null);
});

test('a single-entry pool replays that entry even when it is current', () => {
  assert.equal(pickIdleAnimation(['solo'], 'solo'), 'solo');
});

test('never picks the one already playing while another is available', () => {
  const pool = ['a', 'b', 'c'];
  // Every position of the underlying random, so this cannot pass by luck.
  for (const roll of [0, 0.34, 0.5, 0.67, 0.99, 1]) {
    assert.notEqual(pickIdleAnimation(pool, 'b', () => roll), 'b');
  }
});

test('a random of exactly 1 stays in range rather than falling off the end', () => {
  assert.equal(pickIdleAnimation(['a', 'b'], null, () => 1), 'b');
});
