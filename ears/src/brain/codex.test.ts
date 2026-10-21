import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { ChildLike, SpawnFn } from '../session.ts';
import { CodexSession } from './codex.ts';

interface Rpc { id?: number; method?: string; params?: Record<string, unknown>; result?: unknown; error?: unknown }

/**
 * Stands in for `codex app-server`: answers the handshake and thread start by
 * itself, records everything written, and lets a test push notifications.
 */
function fakeServer(options: { threadError?: string; turnError?: string } = {}) {
  const child = new EventEmitter() as EventEmitter & {
    sent: Rpc[];
    killed: boolean;
    stdin: EventEmitter & { write(chunk: string): void; end(): void };
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill(): void;
  };
  child.sent = [];
  child.killed = false;
  const reply = (message: Rpc) => queueMicrotask(() => child.stdout.emit('data', JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n'));
  child.stdin = Object.assign(new EventEmitter(), {
    write(chunk: string) {
      for (const text of chunk.split('\n').filter(Boolean)) {
        const message = JSON.parse(text) as Rpc;
        child.sent.push(message);
        if (message.id === undefined || message.method === undefined) continue;
        if (message.method === 'initialize') reply({ id: message.id, result: { userAgent: 'test' } });
        if (message.method === 'thread/start' || message.method === 'thread/resume') {
          reply(options.threadError
            ? { id: message.id, error: { code: -1, message: options.threadError } }
            : { id: message.id, result: { thread: { id: (message.params?.threadId as string) ?? 'thread-1' }, model: 'm' } });
        }
        if (message.method === 'turn/start') {
          reply(options.turnError
            ? { id: message.id, error: { code: -1, message: options.turnError } }
            : { id: message.id, result: { turn: { id: 'turn-1' } } });
        }
      }
    },
    end() {},
  });
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => { child.killed = true; };

  const notify = (method: string, params: Record<string, unknown>) =>
    child.stdout.emit('data', JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  return { child, notify };
}

function start(server = fakeServer(), extra: { model?: string; resume?: string } = {}) {
  const calls: { command: string; args: string[]; cwd?: string }[] = [];
  const spawn: SpawnFn = (command, args, opts) => {
    calls.push({ command, args, cwd: opts?.cwd });
    return server.child as unknown as ChildLike;
  };
  const session = new CodexSession({
    command: 'codex.exe',
    cwd: 'Z:\\repo',
    engine: { command: 'C:\\node.exe', args: ['--no-warnings', 'Z:\\repo\\engine\\src\\server.ts'] },
    spawn,
    ...extra,
  });
  return { ...server, calls, session };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const delta = (itemId: string, text: string) => ({ threadId: 'thread-1', turnId: 'turn-1', itemId, delta: text });
const agentMessage = (id: string, text: string) => ({ threadId: 'thread-1', turnId: 'turn-1', item: { type: 'agentMessage', id, text } });
const completed = (status = 'completed', error: unknown = null) => ({ threadId: 'thread-1', turn: { id: 'turn-1', status, error } });

test('runs codex app-server in the project dir', () => {
  const { calls } = start();
  assert.equal(calls[0].command, 'codex.exe');
  assert.deepEqual(calls[0].args, ['app-server']);
  assert.equal(calls[0].cwd, 'Z:\\repo');
});

test('handshakes, then starts a thread with the engine as an MCP server and no approvals', async () => {
  const { child } = start(fakeServer(), { model: 'gpt-x' });
  await flush();

  const [init, initialized, thread] = child.sent;
  assert.equal(init.method, 'initialize');
  assert.equal(initialized.method, 'initialized');
  assert.equal(initialized.id, undefined, 'a notification carries no id');
  assert.equal(thread.method, 'thread/start');
  assert.equal(thread.params?.cwd, 'Z:\\repo');
  assert.equal(thread.params?.model, 'gpt-x');
  assert.equal(thread.params?.approvalPolicy, 'never');
  const config = thread.params?.config as Record<string, unknown>;
  assert.deepEqual((config.mcp_servers as Record<string, unknown>)['avelyn-engine'], {
    command: 'C:\\node.exe',
    args: ['--no-warnings', 'Z:\\repo\\engine\\src\\server.ts'],
  });
});

test('keeps the user\'s Codex memories out of her context', async () => {
  const { child } = start();
  await flush();
  const thread = child.sent.find((m) => m.method === 'thread/start');
  const config = thread?.params?.config as { features?: { memories?: boolean } };
  assert.equal(config.features?.memories, false);
});

test('resumes the given thread instead of starting a new one', async () => {
  const { child, session } = start(fakeServer(), { resume: 'thread-9' });
  await flush();
  const resume = child.sent.find((m) => m.method === 'thread/resume');
  assert.equal(resume?.params?.threadId, 'thread-9');
  assert.equal(child.sent.some((m) => m.method === 'thread/start'), false);
  assert.equal(session.sessionId, 'thread-9');
});

test('records the thread id so a crash can resume it', async () => {
  const { session } = start();
  await flush();
  assert.equal(session.sessionId, 'thread-1');
});

test('an ask becomes a turn on the thread, and resolves with her message', async () => {
  const { child, notify, session } = start();
  const reply = session.ask('what are you doing');
  await flush();

  const turn = child.sent.find((m) => m.method === 'turn/start');
  assert.equal(turn?.params?.threadId, 'thread-1');
  assert.deepEqual(turn?.params?.input, [{ type: 'text', text: 'what are you doing', text_elements: [] }]);

  notify('item/completed', agentMessage('m1', 'Watching you type.'));
  notify('turn/completed', completed());
  assert.equal(await reply, 'Watching you type.');
});

test('streams her text, and a new message after a tool call starts the subtitle over', async () => {
  const { notify, session } = start();
  const seen: string[] = [];
  const reply = session.ask('hi', { onText: (text) => seen.push(text) });
  await flush();

  notify('item/agentMessage/delta', delta('m1', 'Let me '));
  notify('item/agentMessage/delta', delta('m1', 'look.'));
  notify('item/completed', agentMessage('m1', 'Let me look.'));
  notify('item/agentMessage/delta', delta('m2', 'Nice tabs.'));
  notify('item/completed', agentMessage('m2', 'Nice tabs.'));
  notify('turn/completed', completed());

  assert.deepEqual(seen, ['Let me ', 'Let me look.', 'Nice tabs.']);
  assert.equal(await reply, 'Nice tabs.');
});

test('a failed turn rejects with codex\'s error message', async () => {
  const { notify, session } = start();
  const reply = session.ask('hi');
  await flush();
  notify('turn/completed', completed('failed', { message: 'usage limit reached' }));
  await assert.rejects(reply, /usage limit reached/);
});

test('a refused turn/start rejects that turn', async () => {
  const { session } = start(fakeServer({ turnError: 'thread not found' }));
  await assert.rejects(session.ask('hi'), /thread not found/);
});

test('a thread that will not start fails every ask, and counts as the brain dying', async () => {
  const { session } = start(fakeServer({ threadError: 'not logged in' }));
  await assert.rejects(session.ask('hi'), /not logged in/);
  assert.equal(session.died, true);
});

test('turns are serialized: a second ask waits for the first to complete', async () => {
  const { child, notify, session } = start();
  const first = session.ask('one');
  const second = session.ask('two');
  await flush();
  assert.equal(child.sent.filter((m) => m.method === 'turn/start').length, 1);

  notify('item/completed', agentMessage('m1', 'first'));
  notify('turn/completed', completed());
  assert.equal(await first, 'first');
  await flush();
  assert.equal(child.sent.filter((m) => m.method === 'turn/start').length, 2);

  notify('item/completed', agentMessage('m2', 'second'));
  notify('turn/completed', completed());
  assert.equal(await second, 'second');
});

test('a request from the server (an approval) is answered at once, never left hanging', async () => {
  const { child, session } = start();
  const reply = session.ask('hi');
  await flush();
  child.stdout.emit('data', JSON.stringify({ jsonrpc: '2.0', id: 77, method: 'item/commandExecution/requestApproval', params: {} }) + '\n');

  const answer = child.sent.find((m) => m.id === 77);
  assert.ok(answer, 'answered');
  assert.ok(answer?.error, 'with an error, i.e. declined');
  void reply.catch(() => {});
  session.close();
});

test('the process exiting rejects the turn in flight and marks the brain dead', async () => {
  const { child, session } = start();
  const reply = session.ask('hi');
  await flush();
  child.emit('close');
  await assert.rejects(reply, /exited/);
  assert.equal(session.died, true);
});

test('close() kills the process and is not a death', async () => {
  const { child, session } = start();
  await flush();
  session.close();
  assert.equal(child.killed, true);
  assert.equal(session.died, false);
});

test('reports the model the thread actually runs on', async () => {
  const { session } = start();
  await flush();
  assert.equal(session.model, 'm');
});

test('the subtitle is her message before the speak call, not one written after it', async () => {
  const { notify, session } = start();
  const seen: string[] = [];
  const reply = session.ask('hi', { onText: (text) => seen.push(text) });
  await flush();

  notify('item/agentMessage/delta', delta('m1', 'Evening.'));
  notify('item/completed', agentMessage('m1', 'Evening.'));
  notify('item/started', { threadId: 'thread-1', turnId: 'turn-1', item: { type: 'mcpToolCall', id: 't1', server: 'avelyn-engine', tool: 'speak' } });
  notify('item/agentMessage/delta', delta('m2', 'Said it aloud.'));
  notify('item/completed', agentMessage('m2', 'Said it aloud.'));
  notify('turn/completed', completed());

  assert.equal(await reply, 'Evening.');
  assert.deepEqual(seen, ['Evening.']);
});

test('with no message before the speak call, the subtitle is the spoken line', async () => {
  const { notify, session } = start();
  const reply = session.ask('hi', { onText: () => {} });
  await flush();

  notify('item/started', { threadId: 'thread-1', turnId: 'turn-1', item: { type: 'mcpToolCall', id: 't1', server: 'avelyn-engine', tool: 'speak', arguments: { text: 'こんばんは。' } } });
  notify('item/agentMessage/delta', delta('m2', 'Spoken.'));
  notify('item/completed', agentMessage('m2', 'Spoken.'));
  notify('turn/completed', completed());

  assert.equal(await reply, 'こんばんは。');
});
