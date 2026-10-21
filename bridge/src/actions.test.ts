import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getAction } from './actions.ts';

// The stage resolves animation.play by id, then by label. A scanned folder's
// ids hash the file's absolute path, so they differ on every clone; the label
// is the file name, the same everywhere.
test('greet names its clip by label, so it resolves on any machine', () => {
  assert.equal(getAction('greet')?.animationId, 'Greeting');
});
