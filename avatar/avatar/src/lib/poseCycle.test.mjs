import assert from 'node:assert/strict';
import test from 'node:test';
import { jitterHoldSeconds, shuffle } from './poseCycle.js';

test('shuffle returns a permutation and does not mutate the input', () => {
  const items = ['a', 'b', 'c', 'd', 'e'];
  const copy = [...items];
  const result = shuffle(items, () => 0.999999);

  assert.deepEqual([...items], copy, 'input array was mutated');
  assert.equal(result.length, items.length);
  assert.deepEqual([...result].sort(), [...items].sort());
});

test('shuffle with a deterministic random is reproducible', () => {
  const items = [1, 2, 3, 4];
  const sequence = [0.9, 0.1, 0.5];
  const makeRandom = () => {
    let i = 0;
    return () => sequence[i++ % sequence.length];
  };

  assert.deepEqual(shuffle(items, makeRandom()), shuffle(items, makeRandom()));
});

test('jitterHoldSeconds stays within +/-30% of the base', () => {
  assert.ok(Math.abs(jitterHoldSeconds(10, () => 0) - 7) < 1e-9);
  assert.ok(Math.abs(jitterHoldSeconds(10, () => 1) - 13) < 1e-9);
  assert.ok(Math.abs(jitterHoldSeconds(10, () => 0.5) - 10) < 1e-9);
});
