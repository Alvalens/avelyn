import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Session, type ChildLike, type SpawnFn } from './session.ts';

/** Stands in for the agy child: records stdin, lets a test emit stdout. */
function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    written: string[];
    killed: boolean;
    stdin: EventEmitter & { write(chunk: string): void; end(): void };
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill(): void;
  };
  child.written = [];
  child.killed = false;
  // An emitter, like a real pipe: a write to a dead child surfaces as an
  // 'error' event on stdin, not as a throw from write().
  child.stdin = Object.assign(new EventEmitter(), {
    write(chunk: string) { child.written.push(chunk); },
    end() {},
  });
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => { child.killed = true; };
  return child;
}

function harness() {
  const child = fakeChild();
  const calls: { command: string; args: string[]; cwd?: string }[] = [];
  const spawn: SpawnFn = (command, args, options) => {
    calls.push({ command, args, cwd: options?.cwd });
    return child as unknown as ChildLike;
  };
  return { child, calls, spawn };
}

// No `args` here on purpose: omitting it lets Session use its real AGY_ARGS,
// which is what the invocation test needs to be checking.
const OPTS = { command: 'agy', cwd: 'C:\\avelyn-home' };

/** Emit a whole turn the way agy does: init, then a result. */
function emitTurn(child: EventEmitter & { stdout: EventEmitter }, response: string, status = 'SUCCESS') {
  child.stdout.emit('data', JSON.stringify({
    event: 'result',
    result: { conversation_id: 'c1', status, response },
  }) + '\n');
}

test('spawns agy in the project dir with stream-json in and out', () => {
  const h = harness();
  new Session({ ...OPTS, spawn: h.spawn });

  const { command, args, cwd } = h.calls[0];
  assert.equal(command, 'agy');
  assert.equal(cwd, 'C:\\avelyn-home');
  assert.equal(args[args.indexOf('--input-format') + 1], 'stream-json');
  assert.equal(args[args.indexOf('--output-format') + 1], 'stream-json');
  assert.ok(args.includes('--new-project'), 'without it AGENTS.md is skipped');
});

test('agy args add the folders she must read outside her home', async () => {
  const { agyDialect } = await import('./brain/agy.ts');
  const args = agyDialect.args({ readDirs: ['C:/Jane Doe/captures'] });
  assert.equal(args[args.indexOf('--add-dir') + 1], 'C:/Jane Doe/captures');
});

test('writes one NDJSON user event per ask', async () => {
  const h = harness();
  const session = new Session({ ...OPTS, spawn: h.spawn });

  const pending = session.ask('what are you working on');
  emitTurn(h.child, 'Nothing good. You?');
  await pending;

  assert.equal(h.child.written.length, 1);
  assert.equal(h.child.written[0].endsWith('\n'), true, 'NDJSON is newline-delimited');
  assert.deepEqual(JSON.parse(h.child.written[0]), {
    event: 'user',
    message: { role: 'user', content: 'what are you working on' },
  });
});

test('resolves with the reply text', async () => {
  const h = harness();
  const session = new Session({ ...OPTS, spawn: h.spawn });

  const pending = session.ask('hi');
  emitTurn(h.child, 'Nothing good. You?');

  assert.equal(await pending, 'Nothing good. You?');
});

test('keeps one child across turns rather than respawning', async () => {
  const h = harness();
  const session = new Session({ ...OPTS, spawn: h.spawn });

  const first = session.ask('one');
  emitTurn(h.child, 'a');
  await first;

  const second = session.ask('two');
  emitTurn(h.child, 'b');
  await second;

  assert.equal(h.calls.length, 1, 'spawned once for the whole conversation');
  assert.equal(h.child.written.length, 2, 'both turns went to the same process');
});

// stdout arrives in arbitrary chunks. A parser that splits each chunk on
// newlines independently loses any event straddling a boundary — and that
// failure is silent, showing up only as a turn that never answers.
test('reassembles a result split across chunk boundaries', async () => {
  const h = harness();
  const session = new Session({ ...OPTS, spawn: h.spawn });

  const pending = session.ask('hi');
  const line = JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: 'split reply' } }) + '\n';
  for (const piece of [line.slice(0, 17), line.slice(17, 40), line.slice(40)]) {
    h.child.stdout.emit('data', piece);
  }

  assert.equal(await pending, 'split reply');
});

test('handles several events arriving in one chunk', async () => {
  const h = harness();
  const session = new Session({ ...OPTS, spawn: h.spawn });

  const pending = session.ask('hi');
  h.child.stdout.emit('data',
    JSON.stringify({ event: 'init', conversation_id: 'c9' }) + '\n' +
    JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: 'batched' } }) + '\n');

  assert.equal(await pending, 'batched');
});

test('ignores events that are not the turn result', async () => {
  const h = harness();
  const session = new Session({ ...OPTS, spawn: h.spawn });

  const pending = session.ask('hi');
  h.child.stdout.emit('data', JSON.stringify({ event: 'thinking', text: 'hmm' }) + '\n');
  emitTurn(h.child, 'real reply');

  assert.equal(await pending, 'real reply');
});

test('a non-success status rejects with the reported error', async () => {
  const h = harness();
  const session = new Session({ ...OPTS, spawn: h.spawn });

  const pending = session.ask('hi');
  h.child.stdout.emit('data', JSON.stringify({
    event: 'result',
    result: { status: 'ERROR', response: '', error: 'stream input is malformed' },
  }) + '\n');

  await assert.rejects(() => pending, /stream input is malformed/);
});

test('a second ask waits its turn instead of interleaving', async () => {
  const h = harness();
  const session = new Session({ ...OPTS, spawn: h.spawn });

  const first = session.ask('one');
  const second = session.ask('two');
  assert.equal(h.child.written.length, 1, 'second turn not sent while the first is in flight');

  emitTurn(h.child, 'a');
  await first;
  emitTurn(h.child, 'b');
  await second;

  assert.equal(h.child.written.length, 2);
});

test('losing the child rejects the in-flight turn rather than hanging', async () => {
  const h = harness();
  const session = new Session({ ...OPTS, spawn: h.spawn });

  const pending = session.ask('hi');
  h.child.emit('close', 1);

  await assert.rejects(() => pending, /exited|closed|lost/i);
});

test('records the conversation id from init so a restart can resume', async () => {
  const h = harness();
  const session = new Session({ ...OPTS, spawn: h.spawn });

  const pending = session.ask('hi');
  h.child.stdout.emit('data', JSON.stringify({ event: 'init', conversation_id: 'conv-42' }) + '\n');
  emitTurn(h.child, 'ok');
  await pending;

  assert.equal(session.sessionId, 'conv-42');
});

test('close() kills the child', () => {
  const h = harness();
  const session = new Session({ ...OPTS, spawn: h.spawn });

  session.close();

  assert.equal(h.child.killed, true);
});

// A dead agy used to take the whole pipeline down: the next write to its stdin
// raised EPIPE as an unhandled 'error' event. Found 2026-10-05 when a launch
// greeting was queued against an agy that had already exited.
test('an ask after agy has exited rejects without writing to it', async () => {
  const h = harness();
  const session = new Session({ ...OPTS, spawn: h.spawn });
  h.child.emit('close');

  await assert.rejects(session.ask('hello'), /exited/);
  assert.equal(h.child.written.length, 0);
});

test('a broken stdin pipe rejects the pending turn instead of crashing', async () => {
  const h = harness();
  const session = new Session({ ...OPTS, spawn: h.spawn });

  const turn = session.ask('hello');
  h.child.stdin.emit('error', new Error('write EPIPE'));

  await assert.rejects(turn, /EPIPE/);
});

// The host restarts a pipeline that exits. A session whose agy died has to be
// visible from outside, or the pipeline would stay up answering every turn
// with an error and never be replaced.
test('reports when agy died on its own, but not after a deliberate close', () => {
  const crashed = harness();
  const a = new Session({ ...OPTS, spawn: crashed.spawn });
  assert.equal(a.died, false);
  crashed.child.emit('close');
  assert.equal(a.died, true);

  const closed = harness();
  const b = new Session({ ...OPTS, spawn: closed.spawn });
  b.close();
  assert.equal(b.died, false);
});
