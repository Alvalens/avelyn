import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { holdNoLook } from '../../vision/src/nolook.ts';
import type { EngineContext } from './context.ts';
import { look } from './tools.ts';

const deps = {
  foreground: async () => ({ process: 'Code', title: 'Avelyn' }),
  grab: async (path: string) => writeFile(path, 'png'),
};

// Final review #4: the pipeline raises the marker; the tool must honour it.
test('look refuses while the no-look marker is held, and works once it is released', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'avelyn-engine-nolook-'));
  try {
    const noLookPath = join(dir, 'no-look.flag');
    const ctx = { vision: { dir, settingsPath: join(dir, 'settings.json'), noLookPath } } as EngineContext;

    await holdNoLook(noLookPath, true);
    const refused = await look(ctx, deps);
    assert.deepEqual([refused.ok, !refused.ok && refused.reason], [false, 'disabled']);
    assert.equal((await readdir(dir)).filter((name) => name.endsWith('.png')).length, 0);

    await holdNoLook(noLookPath, false);
    const allowed = await look(ctx, deps);
    assert.equal(allowed.ok, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
