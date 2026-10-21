import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfigFromEnv, REPO_ROOT } from './config.ts';

const ENV = { LOCALAPPDATA: 'C:\\Users\\Someone\\AppData\\Local' };

test('resolves whisper under LOCALAPPDATA by default', () => {
  const config = loadConfigFromEnv(ENV);

  assert.equal(config.whisperBinaryPath,
    'C:\\Users\\Someone\\AppData\\Local\\avelyn\\whisper\\bin\\Release\\whisper-cli.exe');
  assert.equal(config.whisperModelPath,
    'C:\\Users\\Someone\\AppData\\Local\\avelyn\\whisper\\models\\ggml-base.en.bin');
});

test('passes no decoder prompt by default', () => {
  // A prompt of "Avelyn" made whisper skip a spoken "Hi Avelyn." entirely —
  // it reads prompt text as already said. Her name is fixed after the fact
  // by correctTranscript instead. Measured 2026-10-05, not assumed.
  assert.equal(loadConfigFromEnv(ENV).prompt, '');
});

test('the brain is agy, on its default model, unless told otherwise', () => {
  assert.deepEqual(loadConfigFromEnv(ENV).brain, { provider: 'agy', model: '', binary: '', resume: '' });
});

test('picks the brain, model and resume id from the env the app sets', () => {
  const brain = loadConfigFromEnv({
    ...ENV,
    AVELYN_BRAIN: 'Claude',
    AVELYN_BRAIN_MODEL: 'sonnet',
    AVELYN_RESUME: 'sess-7',
  }).brain;
  assert.deepEqual(brain, { provider: 'claude', model: 'sonnet', binary: '', resume: 'sess-7' });
});

test('an unknown brain falls back to agy rather than failing to start', () => {
  assert.equal(loadConfigFromEnv({ ...ENV, AVELYN_BRAIN: 'skynet' }).brain.provider, 'agy');
});

test('AGY_BINARY still overrides the agy executable; AVELYN_BRAIN_BINARY any brain\'s', () => {
  assert.equal(loadConfigFromEnv({ ...ENV, AGY_BINARY: 'D:\\agy.exe' }).brain.binary, 'D:\\agy.exe');
  assert.equal(loadConfigFromEnv({ ...ENV, AVELYN_BRAIN: 'codex', AGY_BINARY: 'D:\\agy.exe' }).brain.binary, '');
  assert.equal(
    loadConfigFromEnv({ ...ENV, AVELYN_BRAIN: 'codex', AVELYN_BRAIN_BINARY: 'D:\\codex.exe' }).brain.binary,
    'D:\\codex.exe',
  );
});

test('env vars override every whisper path and the project dir', () => {
  const config = loadConfigFromEnv({
    ...ENV,
    WHISPER_BINARY: 'D:\\other\\whisper-cli.exe',
    WHISPER_MODEL: 'D:\\other\\model.bin',
    AVELYN_PROJECT_DIR: 'D:\\proj',
    WHISPER_PROMPT: 'Avelyn, pagination, VOICEVOX',
  });

  assert.equal(config.whisperBinaryPath, 'D:\\other\\whisper-cli.exe');
  assert.equal(config.whisperModelPath, 'D:\\other\\model.bin');
  assert.equal(config.cwd, 'D:\\proj');
  assert.equal(config.prompt, 'Avelyn, pagination, VOICEVOX');
});

test('her session runs in her own home, outside the repo — the repo root AGENTS.md is the setup guide', () => {
  const config = loadConfigFromEnv(ENV);
  assert.equal(config.cwd, join(ENV.LOCALAPPDATA, 'avelyn', 'home'));
  assert.equal(config.ownHome, true, 'so the pipeline copies the persona in');
  assert.ok(existsSync(join(REPO_ROOT, 'persona', 'AGENTS.md')), 'the persona it copies');
});

test('a project dir set by hand is used as is, and nothing is copied into it', () => {
  const config = loadConfigFromEnv({ ...ENV, AVELYN_PROJECT_DIR: 'D:/proj' });
  assert.equal(config.cwd, 'D:/proj');
  assert.equal(config.ownHome, false);
});

test('an empty override is ignored rather than blanking the value', () => {
  // An unset variable in a .env file often arrives as '' — treating that as a
  // real value would produce a config full of empty strings that fail at
  // spawn time with an error that names nothing.
  const config = loadConfigFromEnv({ ...ENV, WHISPER_BINARY: '', AVELYN_BRAIN: '' });

  assert.equal(config.whisperBinaryPath,
    'C:\\Users\\Someone\\AppData\\Local\\avelyn\\whisper\\bin\\Release\\whisper-cli.exe');
  assert.equal(config.brain.provider, 'agy');
});
