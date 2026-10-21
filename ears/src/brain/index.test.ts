import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { ChildLike, SpawnFn } from '../session.ts';
import { createBrain, engineLaunch, resolveBinary } from './index.ts';

const ENV = {
  PATH: 'C:\\Windows;C:\\tools',
  LOCALAPPDATA: 'C:\\Users\\Someone\\AppData\\Local',
  USERPROFILE: 'C:\\Users\\Someone',
};

test('an explicit binary wins over any lookup', () => {
  assert.equal(resolveBinary('claude', 'D:\\claude.exe', ENV, () => false), 'D:\\claude.exe');
});

test('finds the CLI as an .exe on PATH — spawn without a shell will not apply PATHEXT itself', () => {
  const exists = (path: string) => path === 'C:\\tools\\codex.exe';
  assert.equal(resolveBinary('codex', '', ENV, exists), 'C:\\tools\\codex.exe');
});

test('falls back to where each CLI installs itself', () => {
  const none = () => false;
  assert.equal(resolveBinary('agy', '', ENV, none), 'C:\\Users\\Someone\\AppData\\Local\\agy\\bin\\agy.exe');
  assert.equal(resolveBinary('claude', '', ENV, none), 'C:\\Users\\Someone\\.local\\bin\\claude.exe');
  assert.equal(resolveBinary('codex', '', ENV, none),
    'C:\\Users\\Someone\\AppData\\Local\\Programs\\OpenAI\\Codex\\bin\\codex.exe');
});

test('the engine is started with the same Node running this pipeline, from this repo', () => {
  const engine = engineLaunch('C:\\Users\\Jane Doe\\code\\avelyn', 'C:\\node\\node.exe');
  assert.equal(engine.command, 'C:\\node\\node.exe');
  assert.deepEqual(engine.args, ['--no-warnings', 'C:\\Users\\Jane Doe\\code\\avelyn\\engine\\src\\server.ts']);
});

function recordingSpawn() {
  const calls: { command: string; args: string[]; cwd?: string }[] = [];
  const spawn: SpawnFn = (command, args, options) => {
    calls.push({ command, args, cwd: options?.cwd });
    const child = new EventEmitter() as EventEmitter & Record<string, unknown>;
    child.stdin = Object.assign(new EventEmitter(), { write() {}, end() {} });
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    return child as unknown as ChildLike;
  };
  return { calls, spawn };
}

const BASE = {
  cwd: 'C:\\home',
  repoRoot: 'Z:\\repo',
  readDirs: ['Z:\\repo\\vision\\captures'],
  env: ENV,
  exists: () => false,
  nodePath: 'C:\\node.exe',
};

test('agy: its own args, with the model and resume id passed through', () => {
  const { calls, spawn } = recordingSpawn();
  createBrain({ provider: 'agy', model: 'gemini-x', binary: '', resume: 'c-1' }, { ...BASE, spawn });

  assert.match(calls[0].command, /agy\.exe$/);
  assert.equal(calls[0].cwd, 'C:\\home', 'her home, not the repo');
  assert.equal(calls[0].args[calls[0].args.indexOf('--add-dir') + 1], 'Z:\\repo\\vision\\captures');
  assert.equal(calls[0].args[calls[0].args.indexOf('--model') + 1], 'gemini-x');
  assert.equal(calls[0].args[calls[0].args.indexOf('--conversation') + 1], 'c-1');
});

test('claude: stream-json, with this repo\'s engine in its MCP config', () => {
  const { calls, spawn } = recordingSpawn();
  createBrain({ provider: 'claude', model: '', binary: '', resume: '' }, { ...BASE, spawn });

  assert.match(calls[0].command, /claude\.exe$/);
  const mcp = JSON.parse(calls[0].args[calls[0].args.indexOf('--mcp-config') + 1]);
  // From the repo root, not from her home — the engine lives in the repo.
  assert.deepEqual(mcp.mcpServers['avelyn-engine'].args, ['--no-warnings', 'Z:\\repo\\engine\\src\\server.ts']);
  assert.equal(calls[0].cwd, 'C:\\home');
  assert.equal(calls[0].args[calls[0].args.indexOf('--add-dir') + 1], 'Z:\\repo\\vision\\captures');
});

test('codex: the app-server', () => {
  const { calls, spawn } = recordingSpawn();
  const brain = createBrain({ provider: 'codex', model: '', binary: '', resume: '' }, { ...BASE, spawn });

  assert.match(calls[0].command, /codex\.exe$/);
  assert.deepEqual(calls[0].args, ['app-server']);
  brain.close();
});

test('agy on its default model reports the default from its own settings — it never says in the stream', () => {
  const { spawn } = recordingSpawn();
  const readAgySettings = () => JSON.stringify({ model: 'Gemini 3.8 Flash (Medium)' });
  const brain = createBrain({ provider: 'agy', model: '', binary: '', resume: '' }, { ...BASE, spawn, readAgySettings });
  assert.equal(brain.model, 'Gemini 3.8 Flash (Medium)');
});

test('agy on a picked model reports that one; unreadable settings report nothing rather than guessing', () => {
  const { spawn } = recordingSpawn();
  const picked = createBrain({ provider: 'agy', model: 'gemini-x', binary: '', resume: '' }, { ...BASE, spawn, readAgySettings: () => '{}' });
  assert.equal(picked.model, 'gemini-x');

  const unknown = createBrain({ provider: 'agy', model: '', binary: '', resume: '' }, {
    ...BASE, spawn, readAgySettings: () => { throw new Error('ENOENT'); },
  });
  assert.equal(unknown.model, null);
});

// A user with only Claude Code or Codex got a restart loop: the default brain
// is agy, spawning it failed, the pipeline exited, the app restarted it.
test('a chosen CLI that is not installed falls back to one that is, without its model', async () => {
  const { resolveProvider } = await import('./index.ts');
  const claudeOnly = (path: string) => path.endsWith('claude.exe');
  assert.deepEqual(
    resolveProvider({ provider: 'agy', model: 'gemini-x', binary: '', resume: '' }, ENV, claudeOnly),
    { provider: 'claude', model: '', binary: '', resume: '' },
  );
});

test('an installed choice, a hand-set binary, or nothing installed at all keeps the choice', async () => {
  const { resolveProvider } = await import('./index.ts');
  const all = () => true;
  const none = () => false;
  const chosen = { provider: 'codex' as const, model: 'gpt-x', binary: '', resume: '' };
  assert.deepEqual(resolveProvider(chosen, ENV, all), chosen);
  assert.deepEqual(resolveProvider({ ...chosen, binary: 'D:\codex.exe' }, ENV, none), { ...chosen, binary: 'D:\codex.exe' });
  assert.deepEqual(resolveProvider(chosen, ENV, none), chosen, 'its own error then says what is missing');
});
