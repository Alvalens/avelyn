import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readRuntime, runtimePath } from './runtime.ts';
import { liveBusConfig, loadConfigFromEnv } from './agentBusClient.ts';

const dir = mkdtempSync(join(tmpdir(), 'avelyn-runtime-'));
function runtimeFile(content: unknown): string {
  const path = join(dir, `${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content));
  return path;
}

test('the runtime file lives in the per-user avelyn folder, beside whisper', () => {
  assert.equal(runtimePath({ LOCALAPPDATA: 'C:\\Users\\X\\AppData\\Local' }), join('C:\\Users\\X\\AppData\\Local', 'avelyn', 'runtime.json'));
  assert.equal(runtimePath({ LOCALAPPDATA: 'C:\\L', AVELYN_RUNTIME: 'D:\\r.json' }), 'D:\\r.json');
});

test('a missing or broken runtime file reads as empty, never throws', () => {
  assert.deepEqual(readRuntime(join(dir, 'nope.json')), {});
  assert.deepEqual(readRuntime(runtimeFile('{not json')), {});
  assert.deepEqual(readRuntime(runtimeFile('[1,2]')), {});
});

test('the bus comes from the runtime file the app writes — no .env needed', () => {
  const path = runtimeFile({ bus: { url: 'http://127.0.0.1:47903', token: 'from-app' } });
  assert.deepEqual(loadConfigFromEnv({ AVELYN_RUNTIME: path }), { baseUrl: 'http://127.0.0.1:47903', token: 'from-app' });
});

test('env vars still win, for tests and development', () => {
  const path = runtimeFile({ bus: { url: 'http://127.0.0.1:47903', token: 'from-app' } });
  const config = loadConfigFromEnv({ AVELYN_RUNTIME: path, AVATAR_BUS_TOKEN: 'from-env', AVATAR_BUS_URL: 'http://x' });
  assert.deepEqual(config, { baseUrl: 'http://x', token: 'from-env' });
});

test('a bus running without a token is reachable with none', () => {
  const path = runtimeFile({ bus: { url: 'http://127.0.0.1:47903', token: null } });
  assert.deepEqual(loadConfigFromEnv({ AVELYN_RUNTIME: path }), { baseUrl: 'http://127.0.0.1:47903', token: '' });
});

test('with no bus anywhere, the error says what to do about it', () => {
  const path = runtimeFile({ bus: null });
  assert.throws(() => loadConfigFromEnv({ AVELYN_RUNTIME: path }), /avatar app.*Settings → Agents/);
});

test('liveBusConfig re-reads on every use: the app may start later, or rotate its token', () => {
  const path = join(dir, 'live.json');
  const config = liveBusConfig(() => loadConfigFromEnv({ AVELYN_RUNTIME: path }));

  assert.throws(() => config.token, /avatar app/);
  writeFileSync(path, JSON.stringify({ bus: { url: 'http://a', token: 'one' } }));
  assert.equal(config.token, 'one');
  writeFileSync(path, JSON.stringify({ bus: { url: 'http://a', token: 'two' } }));
  assert.equal(config.token, 'two');
  assert.equal(config.baseUrl, 'http://a');
});
