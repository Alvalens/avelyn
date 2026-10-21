import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { capture, fileName, prune } from './capture.ts';

async function tempDir() {
  return mkdtemp(join(tmpdir(), 'avelyn-cap-'));
}

test('file names are local-time stamped and sort oldest to newest', () => {
  const a = fileName(new Date(2026, 9, 7, 9, 5, 3, 7));
  const b = fileName(new Date(2026, 9, 7, 14, 0, 0, 0));
  assert.equal(a, 'screen-20261007-090503-007.png');
  assert.ok(a < b);
});

test('capture creates the folder, grabs to the new path and returns it', async () => {
  const root = await tempDir();
  try {
    const dir = join(root, 'captures'); // does not exist yet
    const now = () => new Date(2026, 9, 7, 12, 0, 0, 0);
    const path = await capture({
      dir,
      keep: 5,
      now,
      grab: async (target) => writeFile(target, 'png'),
    });
    assert.equal(path, join(dir, 'screen-20261007-120000-000.png'));
    assert.deepEqual(await readdir(dir), ['screen-20261007-120000-000.png']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('capture keeps only the newest `keep` screenshots', async () => {
  const dir = await tempDir();
  try {
    for (let minute = 0; minute < 5; minute += 1) {
      await capture({
        dir,
        keep: 3,
        now: () => new Date(2026, 9, 7, 12, minute, 0, 0),
        grab: async (target) => writeFile(target, 'png'),
      });
    }
    assert.deepEqual(await readdir(dir), [
      'screen-20261007-120200-000.png',
      'screen-20261007-120300-000.png',
      'screen-20261007-120400-000.png',
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('prune only ever touches screenshots', async () => {
  const dir = await tempDir();
  try {
    await writeFile(join(dir, 'notes.txt'), 'mine');
    await writeFile(join(dir, 'screen-20261007-120000-000.png'), 'png');
    await writeFile(join(dir, 'screen-20261007-120100-000.png'), 'png');
    await prune(dir, 1);
    assert.deepEqual(await readdir(dir), ['notes.txt', 'screen-20261007-120100-000.png']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('prune on a folder that does not exist is not an error', async () => {
  await prune(join(tmpdir(), 'avelyn-does-not-exist-xyz'), 5);
});

test('a failed grab throws and leaves nothing half-counted', async () => {
  const dir = await tempDir();
  try {
    await assert.rejects(
      capture({
        dir,
        keep: 5,
        grab: async () => {
          throw new Error('no display');
        },
      }),
      /no display/,
    );
    assert.deepEqual(await readdir(dir), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
