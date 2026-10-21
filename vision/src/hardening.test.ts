import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { blockedBy } from './blocklist.ts';
import { psQuote, prune } from './capture.ts';
import { parseForeground } from './foreground.ts';
import { look } from './look.ts';
import { holdNoLook, isNoLook } from './nolook.ts';
import { DEFAULT_SETTINGS } from './settings.ts';

const code = { process: 'Code', title: 'Avelyn' };
const keepass = { process: 'KeePass.exe', title: 'Vault' };
const grab = async (path: string) => writeFile(path, 'png');

async function withDir(run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'avelyn-hard-'));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// Final review #1: with no window in front, Get-Process -Id 0 answers "Idle".
test('"Idle" (no window in front) is not a window', () => {
  assert.equal(parseForeground('{"process":"Idle","title":""}'), null);
  assert.equal(parseForeground('{"process":"idle","title":""}'), null);
});

// Final review #3: ProcessName never has .exe, so a needle that does never matched.
test('a blocklist entry written with .exe still matches the process', () => {
  assert.equal(blockedBy({ process: 'KeePassXC', title: '' }, ['KeePassXC.exe']), 'KeePassXC.exe');
  assert.equal(blockedBy({ process: 'KeePassXC.exe', title: '' }, ['keepassxc.EXE']), 'keepassxc.EXE');
});

// Final review #2: the grab is a second PowerShell spawn; the user can switch windows in between.
test('the window is checked again after the grab, and a blocked one deletes the shot', async () => {
  await withDir(async (dir) => {
    let calls = 0;
    const result = await look({
      settings: DEFAULT_SETTINGS,
      dir,
      foreground: async () => (calls++ === 0 ? code : keepass),
      grab,
    });
    assert.deepEqual([result.ok, !result.ok && result.reason], [false, 'blocked']);
    assert.deepEqual(await readdir(dir), []);
  });
});

test('if the window cannot be determined after the grab, the shot is deleted too', async () => {
  await withDir(async (dir) => {
    let calls = 0;
    const result = await look({
      settings: DEFAULT_SETTINGS,
      dir,
      foreground: async () => (calls++ === 0 ? code : null),
      grab,
    });
    assert.deepEqual([result.ok, !result.ok && result.reason], [false, 'failed']);
    assert.deepEqual(await readdir(dir), []);
  });
});

test('a window that stays harmless across the grab is kept', async () => {
  await withDir(async (dir) => {
    const result = await look({ settings: DEFAULT_SETTINGS, dir, foreground: async () => code, grab });
    assert.equal(result.ok, true);
    assert.equal((await readdir(dir)).length, 1);
  });
});

// Final review #4: "look on its own: off" must hold even if the model ignores the prompt.
test('look refuses while she is not allowed to look on her own', async () => {
  await withDir(async (dir) => {
    const result = await look({ settings: DEFAULT_SETTINGS, dir, foreground: async () => code, grab, noLook: true });
    assert.deepEqual([result.ok, !result.ok && result.reason], [false, 'disabled']);
    assert.deepEqual(await readdir(dir), []);
  });
});

test('the no-look marker is on while held, off when released, and expires if never released', async () => {
  await withDir(async (dir) => {
    const flag = join(dir, 'no-look.flag');
    const t0 = 1_000_000;
    assert.equal(await isNoLook(flag, t0), false);

    await holdNoLook(flag, true, t0);
    assert.equal(await isNoLook(flag, t0 + 1_000), true);
    // A pipeline that died mid-nudge must not blind her for good.
    assert.equal(await isNoLook(flag, t0 + 10 * 60_000), false);

    await holdNoLook(flag, false);
    assert.equal(await isNoLook(flag, t0 + 1_000), false);
  });
});

test('a garbage marker file does not block looking', async () => {
  await withDir(async (dir) => {
    const flag = join(dir, 'no-look.flag');
    await writeFile(flag, 'not a number');
    assert.equal(await isNoLook(flag, 5), false);
  });
});

// Final review #16
test('prune only deletes files that carry the timestamped screenshot name', async () => {
  await withDir(async (dir) => {
    await writeFile(join(dir, 'screen-diagram.png'), 'mine');
    await writeFile(join(dir, 'screen-20261007-120000-000.png'), 'png');
    await writeFile(join(dir, 'screen-20261007-120100-000.png'), 'png');
    await prune(dir, 1);
    assert.deepEqual(await readdir(dir), ['screen-20261007-120100-000.png', 'screen-diagram.png']);
  });
});

// Final review #15: PowerShell treats the curly quotes as quote characters too.
test('psQuote doubles every character PowerShell reads as a single quote', () => {
  assert.equal(psQuote("a'b"), "a''b");
  assert.equal(psQuote('Jane’s'), 'Jane’’s');
  assert.equal(psQuote('‘x‚‛'), '‘‘x‚‚‛‛');
});
