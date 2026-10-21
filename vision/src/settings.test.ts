import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_SETTINGS, loadSettings, normalizeSettings } from './settings.ts';

test('nothing at all means the defaults', () => {
  assert.deepEqual(normalizeSettings(undefined), DEFAULT_SETTINGS);
  assert.deepEqual(normalizeSettings('yes'), DEFAULT_SETTINGS);
  assert.deepEqual(normalizeSettings({}), DEFAULT_SETTINGS);
});

test('the defaults are the ones the spec names', () => {
  assert.equal(DEFAULT_SETTINGS.enabled, true);
  assert.equal(DEFAULT_SETTINGS.initiative, true);
  assert.equal(DEFAULT_SETTINGS.lookOnItsOwn, true);
  assert.deepEqual(DEFAULT_SETTINGS.minGapMinutes, [20, 40]);
  assert.equal(DEFAULT_SETTINGS.quietMinutes, 15);
  assert.equal(DEFAULT_SETTINGS.retryGapMinutes, 10);
  assert.equal(DEFAULT_SETTINGS.keep, 50);
});

test('toggles are on unless explicitly false', () => {
  assert.equal(normalizeSettings({ enabled: 'false' }).enabled, true);
  assert.equal(normalizeSettings({ enabled: false }).enabled, false);
  assert.equal(normalizeSettings({ initiative: false }).initiative, false);
  assert.equal(normalizeSettings({ lookOnItsOwn: false }).lookOnItsOwn, false);
});

test('garbage numbers fall back instead of breaking the timers', () => {
  const s = normalizeSettings({ keep: 0, quietMinutes: -3, retryGapMinutes: 'soon', minGapMinutes: ['a', null] });
  assert.equal(s.keep, DEFAULT_SETTINGS.keep);
  assert.equal(s.quietMinutes, DEFAULT_SETTINGS.quietMinutes);
  assert.equal(s.retryGapMinutes, DEFAULT_SETTINGS.retryGapMinutes);
  assert.deepEqual(s.minGapMinutes, DEFAULT_SETTINGS.minGapMinutes);
});

test('keep is a whole number of at least one', () => {
  assert.equal(normalizeSettings({ keep: 7.9 }).keep, 7);
  assert.equal(normalizeSettings({ keep: 0.4 }).keep, DEFAULT_SETTINGS.keep);
});

test('a reversed gap range is put the right way round', () => {
  assert.deepEqual(normalizeSettings({ minGapMinutes: [40, 20] }).minGapMinutes, [20, 40]);
});

test('fractions are allowed so a live check can use a short gap', () => {
  assert.equal(normalizeSettings({ quietMinutes: 0.5 }).quietMinutes, 0.5);
});

test('a blocklist the user wrote replaces the default one, even if empty', () => {
  assert.deepEqual(normalizeSettings({ blocklist: ['Secret Thing', 7, '  '] }).blocklist, ['Secret Thing']);
  assert.deepEqual(normalizeSettings({ blocklist: [] }).blocklist, []);
  assert.deepEqual(normalizeSettings({ blocklist: 'keepass' }).blocklist, DEFAULT_SETTINGS.blocklist);
});

test('loadSettings reads the vision section of the runtime file, and defaults on missing or corrupt ones', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'avelyn-vs-'));
  try {
    assert.deepEqual(await loadSettings(join(dir, 'nope.json')), DEFAULT_SETTINGS);

    const corrupt = join(dir, 'corrupt.json');
    await writeFile(corrupt, '{ not json');
    assert.deepEqual(await loadSettings(corrupt), DEFAULT_SETTINGS);

    const empty = join(dir, 'empty.json');
    await writeFile(empty, '');
    assert.deepEqual(await loadSettings(empty), DEFAULT_SETTINGS);

    const good = join(dir, 'good.json');
    await writeFile(good, JSON.stringify({ bus: null, vision: { initiative: false, keep: 5 } }));
    const s = await loadSettings(good);
    assert.equal(s.initiative, false);
    assert.equal(s.keep, 5);

    const noVision = join(dir, 'no-vision.json');
    await writeFile(noVision, JSON.stringify({ bus: { url: 'http://x', token: 't' } }));
    assert.deepEqual(await loadSettings(noVision), DEFAULT_SETTINGS);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
