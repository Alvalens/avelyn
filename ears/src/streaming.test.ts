import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Session, type ChildLike, type SpawnFn } from './session.ts';
import { createPartialEmitter } from './partial.ts';

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdin: EventEmitter & { write(chunk: string): void; end(): void };
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill(): void;
  };
  child.stdin = Object.assign(new EventEmitter(), { write() {}, end() {} });
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {};
  return child;
}

function session() {
  const child = fakeChild();
  const spawn: SpawnFn = () => child as unknown as ChildLike;
  return { child, session: new Session({ command: 'agy', spawn }) };
}

const line = (event: unknown) => JSON.stringify(event) + '\n';

/** What agy prints for a streamed piece of her reply (shape seen live). */
const step = (index: number, delta: string, type = 'agent_response', state = 'ACTIVE') =>
  line({
    event: 'step_update',
    step_update: { conversation_id: 'c1', step_index: index, state, step_type: type, text_delta: delta },
  });

const result = (response: string) =>
  line({ event: 'result', result: { conversation_id: 'c1', status: 'SUCCESS', response } });

test('her text is handed over as it grows, not just when the turn ends', async () => {
  const { child, session: s } = session();
  const seen: string[] = [];
  const reply = s.ask('hi', { onText: (text) => seen.push(text) });

  child.stdout.emit('data', step(1, 'Hel'));
  child.stdout.emit('data', step(1, 'lo th'));
  child.stdout.emit('data', step(1, 'ere.'));
  assert.deepEqual(seen, ['Hel', 'Hello th', 'Hello there.']);

  child.stdout.emit('data', result('Hello there.'));
  assert.equal(await reply, 'Hello there.');
});

test('a new text step replaces the old one instead of piling on', async () => {
  const { child, session: s } = session();
  const seen: string[] = [];
  const reply = s.ask('hi', { onText: (text) => seen.push(text) });

  child.stdout.emit('data', step(1, 'Let me look.'));
  child.stdout.emit('data', step(3, 'Nothing odd.'));
  assert.equal(seen.at(-1), 'Nothing odd.');

  child.stdout.emit('data', result('Nothing odd.'));
  await reply;
});

test('the closing DONE update counts like any other piece of text', async () => {
  const { child, session: s } = session();
  const seen: string[] = [];
  const reply = s.ask('hi', { onText: (text) => seen.push(text) });

  child.stdout.emit('data', step(1, 'Hello.'));
  child.stdout.emit('data', step(1, '\n', 'agent_response', 'DONE'));
  assert.equal(seen.at(-1), 'Hello.\n');

  child.stdout.emit('data', result('Hello.\n'));
  await reply;
});

test('steps that are not her talking are not surfaced', async () => {
  const { child, session: s } = session();
  const seen: string[] = [];
  const reply = s.ask('hi', { onText: (text) => seen.push(text) });

  child.stdout.emit('data', step(0, 'the user said hi', 'user_input', 'DONE'));
  child.stdout.emit('data', step(2, '{"path":"x.png"}', 'tool_call'));
  child.stdout.emit('data', step(1, ''));
  assert.deepEqual(seen, []);

  child.stdout.emit('data', result('ok'));
  await reply;
});

test('asking without a callback still works, streamed text or not', async () => {
  const { child, session: s } = session();
  const reply = s.ask('hi');
  child.stdout.emit('data', step(1, 'Hello.'));
  child.stdout.emit('data', result('Hello.'));
  assert.equal(await reply, 'Hello.');
});

test('a queued turn gets only its own text, and nothing after its result', async () => {
  const { child, session: s } = session();
  const first: string[] = [];
  const second: string[] = [];
  const a = s.ask('one', { onText: (text) => first.push(text) });
  const b = s.ask('two', { onText: (text) => second.push(text) });

  child.stdout.emit('data', step(1, 'First.'));
  child.stdout.emit('data', result('First.'));
  await a;
  assert.deepEqual(second, []);

  // Late debris from the first turn must not leak into the second, and the
  // second starts a fresh step count.
  child.stdout.emit('data', step(1, 'Second.'));
  assert.deepEqual(second, ['Second.']);
  assert.deepEqual(first, ['First.']);

  child.stdout.emit('data', result('Second.'));
  await b;
  child.stdout.emit('data', step(1, 'stray'));
  assert.deepEqual(second, ['Second.']);
});

test('a callback that throws does not break the turn', async () => {
  const { child, session: s } = session();
  const reply = s.ask('hi', {
    onText: () => {
      throw new Error('renderer gone');
    },
  });
  child.stdout.emit('data', step(1, 'Hello.'));
  child.stdout.emit('data', result('Hello.'));
  assert.equal(await reply, 'Hello.');
});

test('the throttled emitter sends the first piece at once and holds the rest back', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const sent: string[] = [];
  const partials = createPartialEmitter((text) => sent.push(text), 100);

  partials.push('He');
  partials.push('Hel');
  partials.push('Hell');
  assert.deepEqual(sent, ['He']);

  t.mock.timers.tick(100);
  assert.deepEqual(sent, ['He', 'Hell'], 'the latest piece goes out when the interval is up');
});

test('cancel drops a pending piece so it cannot land after the final reply', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const sent: string[] = [];
  const partials = createPartialEmitter((text) => sent.push(text), 100);

  partials.push('He');
  partials.push('Hello');
  partials.cancel();
  t.mock.timers.tick(500);
  assert.deepEqual(sent, ['He']);
});

test('after the interval a new piece goes out immediately again', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const sent: string[] = [];
  const partials = createPartialEmitter((text) => sent.push(text), 100);

  partials.push('A');
  t.mock.timers.tick(150);
  partials.push('AB');
  assert.deepEqual(sent, ['A', 'AB']);
});

test('blank text is never sent, so the bubble does not flash empty', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const sent: string[] = [];
  const partials = createPartialEmitter((text) => sent.push(text), 100);

  partials.push('');
  partials.push('  \n');
  t.mock.timers.tick(500);
  assert.deepEqual(sent, []);
});

// Seen live: once she writes the line before the tool call (so it can stream),
// agy's final `response` carried it twice — the step before the call and the
// one after — and the subtitle showed both.
test('the final reply is the last thing she wrote, not every step glued together', async () => {
  const { child, session: s } = session();
  const reply = s.ask('hi', { onText: () => {} });

  child.stdout.emit('data', step(1, 'Evening. Still at it?'));
  child.stdout.emit('data', step(3, 'Evening. Still at it?'));
  child.stdout.emit('data', result('Evening. Still at it?\nEvening. Still at it?'));
  assert.equal(await reply, 'Evening. Still at it?');
});

test('when her last step says something different, that is the reply', async () => {
  const { child, session: s } = session();
  const reply = s.ask('hi', { onText: () => {} });

  child.stdout.emit('data', step(1, 'Let me check.'));
  child.stdout.emit('data', step(3, 'All good.'));
  child.stdout.emit('data', result('Let me check.\nAll good.'));
  assert.equal(await reply, 'All good.');
});

test('with no streamed text, the result is used as it always was', async () => {
  const { child, session: s } = session();
  const withCallback = s.ask('one', { onText: () => {} });
  child.stdout.emit('data', result('From the result.'));
  assert.equal(await withCallback, 'From the result.');

  const withoutCallback = s.ask('two');
  child.stdout.emit('data', step(1, 'streamed'));
  child.stdout.emit('data', result('From the result too.'));
  assert.equal(await withoutCallback, 'From the result too.');
});

const tool = (index: number, toolName: string, server = 'avelyn-engine') =>
  line({
    event: 'step_update',
    step_update: {
      conversation_id: 'c1', step_index: index, state: 'ACTIVE', step_type: 'tool', tool_name: 'call_mcp_tool',
      tool_info: { name: 'call_mcp_tool', parameters: { Arguments: {}, ServerName: server, ToolName: toolName } },
    },
  });

test('agy: the line before her voice call is the subtitle, whatever she writes after it', async () => {
  const { child, session: s } = session();
  const seen: string[] = [];
  const reply = s.ask('hi', { onText: (text) => seen.push(text) });

  child.stdout.emit('data', step(1, 'Evening.'));
  child.stdout.emit('data', tool(2, 'speak'));
  child.stdout.emit('data', step(3, 'Spoke the greeting.'));
  child.stdout.emit('data', result('Evening.\nSpoke the greeting.'));

  assert.equal(await reply, 'Evening.');
  assert.deepEqual(seen, ['Evening.']);
});

test('agy: a tool from another server named speak is not her voice', async () => {
  const { child, session: s } = session();
  const reply = s.ask('hi', { onText: () => {} });

  child.stdout.emit('data', step(1, 'One sec.'));
  child.stdout.emit('data', tool(2, 'speak', 'someone-else'));
  child.stdout.emit('data', step(3, 'Here.'));
  child.stdout.emit('data', result('One sec.\nHere.'));

  assert.equal(await reply, 'Here.');
});

const voiceTool = (index: number, args: Record<string, unknown>) =>
  line({
    event: 'step_update',
    step_update: {
      conversation_id: 'c1', step_index: index, state: 'ACTIVE', step_type: 'tool', tool_name: 'call_mcp_tool',
      tool_info: { name: 'call_mcp_tool', parameters: { Arguments: args, ServerName: 'avelyn-engine', ToolName: 'speak' } },
    },
  });

test('agy: with no line before the voice call, the subtitle is the spoken line, not what follows', async () => {
  const { child, session: s } = session();
  const reply = s.ask('hi', { onText: () => {} });

  child.stdout.emit('data', voiceTool(1, { text: 'こんばんは。' }));
  child.stdout.emit('data', step(2, 'Spoken.'));
  child.stdout.emit('data', result('Spoken.'));

  assert.equal(await reply, 'こんばんは。');
});

test('a voice call with no line anywhere leaves the subtitle empty rather than showing narration', async () => {
  const { child, session: s } = session();
  const reply = s.ask('hi', { onText: () => {} });

  child.stdout.emit('data', voiceTool(1, {}));
  child.stdout.emit('data', step(2, 'Spoken.'));
  child.stdout.emit('data', result('Spoken.'));

  assert.equal(await reply, '');
});
