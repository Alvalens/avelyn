import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { look } from './look.ts';
import { DEFAULT_SETTINGS } from './settings.ts';

const code = async () => ({ process: 'Code', title: 'Avelyn' });
const grab = async (path: string) => writeFile(path, 'png');

async function withDir(run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'avelyn-look-'));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('looks: captures and returns the saved path', async () => {
  await withDir(async (dir) => {
    const result = await look({ settings: DEFAULT_SETTINGS, dir, foreground: code, grab });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal((await readdir(dir)).length, 1);
  });
});

test('switched off: no capture', async () => {
  await withDir(async (dir) => {
    const result = await look({ settings: { ...DEFAULT_SETTINGS, enabled: false }, dir, foreground: code, grab });
    assert.deepEqual([result.ok, !result.ok && result.reason], [false, 'disabled']);
    assert.deepEqual(await readdir(dir), []);
  });
});

test('blocklisted window: nothing is captured or saved', async () => {
  await withDir(async (dir) => {
    let grabbed = false;
    const result = await look({
      settings: DEFAULT_SETTINGS,
      dir,
      foreground: async () => ({ process: 'KeePass.exe', title: 'Passwords' }),
      grab: async (path) => {
        grabbed = true;
        await writeFile(path, 'png');
      },
    });
    assert.deepEqual([result.ok, !result.ok && result.reason], [false, 'blocked']);
    assert.equal(grabbed, false);
    assert.deepEqual(await readdir(dir), []);
  });
});

test('the refusal does not leak the title of the blocked window', async () => {
  await withDir(async (dir) => {
    const result = await look({
      settings: DEFAULT_SETTINGS,
      dir,
      foreground: async () => ({ process: 'chrome', title: 'Contoso Bank — Account 12345' }),
      grab,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.doesNotMatch(result.message, /Contoso|12345/);
  });
});

test('cannot tell which window is in front: refuses rather than capture blind', async () => {
  await withDir(async (dir) => {
    let grabbed = false;
    const result = await look({
      settings: DEFAULT_SETTINGS,
      dir,
      foreground: async () => null,
      grab: async (path) => {
        grabbed = true;
        await writeFile(path, 'png');
      },
    });
    assert.deepEqual([result.ok, !result.ok && result.reason], [false, 'failed']);
    assert.equal(grabbed, false);
  });
});

test('a throwing foreground lookup is also a refusal, not a crash', async () => {
  await withDir(async (dir) => {
    const result = await look({
      settings: DEFAULT_SETTINGS,
      dir,
      foreground: async () => {
        throw new Error('boom');
      },
      grab,
    });
    assert.deepEqual([result.ok, !result.ok && result.reason], [false, 'failed']);
  });
});

test('a failed grab is reported, with its reason', async () => {
  await withDir(async (dir) => {
    const result = await look({
      settings: DEFAULT_SETTINGS,
      dir,
      foreground: code,
      grab: async () => {
        throw new Error('no display');
      },
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, 'failed');
      assert.match(result.message, /no display/);
    }
  });
});

test('an empty-string blocklist entry does not block every window', async () => {
  await withDir(async (dir) => {
    const result = await look({
      settings: { ...DEFAULT_SETTINGS, blocklist: ['', '  '] },
      dir,
      foreground: code,
      grab,
    });
    assert.equal(result.ok, true);
  });
});
