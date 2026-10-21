import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Session, type ChildLike, type SpawnFn } from '../session.ts';
import { claudeArgs, claudeDialect } from './claude.ts';

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    written: string[];
    stdin: EventEmitter & { write(chunk: string): void; end(): void };
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill(): void;
  };
  child.written = [];
  child.stdin = Object.assign(new EventEmitter(), {
    write(chunk: string) { child.written.push(chunk); },
    end() {},
  });
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {};
  return child;
}

function session() {
  const child = fakeChild();
  const spawn: SpawnFn = () => child as unknown as ChildLike;
  return { child, session: new Session({ command: 'claude', args: [], dialect: claudeDialect(), spawn }) };
}

const line = (event: unknown) => JSON.stringify(event) + '\n';

// Shapes as Claude Code 2.1.292 prints them with --include-partial-messages.
const init = (id: string) => line({ type: 'system', subtype: 'init', session_id: id, tools: [] });
const messageStart = () => line({ type: 'stream_event', event: { type: 'message_start', message: {} } });
const textDelta = (text: string, index = 0) =>
  line({ type: 'stream_event', event: { type: 'content_block_delta', index, delta: { type: 'text_delta', text } } });
const thinkingDelta = (thinking: string) =>
  line({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking } } });
const result = (text: string, isError = false) =>
  line({ type: 'result', subtype: 'success', is_error: isError, result: text, session_id: 's1' });

test('writes one stream-json user message per ask', async () => {
  const { child, session: s } = session();
  const reply = s.ask('what are you working on');
  child.stdout.emit('data', result('Nothing good.'));
  await reply;

  assert.deepEqual(JSON.parse(child.written[0]), {
    type: 'user',
    message: { role: 'user', content: 'what are you working on' },
  });
});

test('records the session id from init so a crash can resume it', async () => {
  const { child, session: s } = session();
  const reply = s.ask('hi');
  child.stdout.emit('data', init('sess-7'));
  child.stdout.emit('data', result('hey'));
  await reply;

  assert.equal(s.sessionId, 'sess-7');
});

test('streams her text, and a new message (after a tool call) starts the subtitle over', async () => {
  const { child, session: s } = session();
  const seen: string[] = [];
  const reply = s.ask('hi', { onText: (text) => seen.push(text) });

  child.stdout.emit('data', messageStart());
  child.stdout.emit('data', textDelta('Late '));
  child.stdout.emit('data', textDelta('one tonight.'));
  child.stdout.emit('data', messageStart());
  child.stdout.emit('data', textDelta('Voice is down.'));
  child.stdout.emit('data', result('Late one tonight.Voice is down.'));

  assert.deepEqual(seen, ['Late ', 'Late one tonight.', 'Voice is down.']);
  assert.equal(await reply, 'Voice is down.');
});

test('thinking is not her talking and never reaches the subtitle', async () => {
  const { child, session: s } = session();
  const seen: string[] = [];
  const reply = s.ask('hi', { onText: (text) => seen.push(text) });

  child.stdout.emit('data', messageStart());
  child.stdout.emit('data', thinkingDelta('the user is up late'));
  child.stdout.emit('data', textDelta('Still up?', 1));
  child.stdout.emit('data', result('Still up?'));

  assert.deepEqual(seen, ['Still up?']);
  assert.equal(await reply, 'Still up?');
});

test('an error result rejects with what Claude said went wrong', async () => {
  const { child, session: s } = session();
  const reply = s.ask('hi');
  child.stdout.emit('data', result('Failed to authenticate: OAuth session expired', true));

  await assert.rejects(reply, /OAuth session expired/);
});

test('args: stream-json both ways, partial messages, and the engine as its only MCP server', () => {
  const args = claudeArgs({ engine: { command: 'C:\\node.exe', args: ['--no-warnings', 'Z:\\repo\\engine\\src\\server.ts'] } });

  assert.equal(args[args.indexOf('--input-format') + 1], 'stream-json');
  assert.equal(args[args.indexOf('--output-format') + 1], 'stream-json');
  assert.ok(args.includes('--include-partial-messages'));
  assert.ok(args.includes('--verbose'), 'stream-json output requires it');
  assert.ok(args.includes('--strict-mcp-config'));
  const mcp = JSON.parse(args[args.indexOf('--mcp-config') + 1]);
  assert.deepEqual(mcp.mcpServers['avelyn-engine'], {
    command: 'C:\\node.exe',
    args: ['--no-warnings', 'Z:\\repo\\engine\\src\\server.ts'],
  });
});

test('args: isolated from the user\'s own Claude Code setup', () => {
  const args = claudeArgs({ engine: { command: 'node', args: [] } });

  // Without these, the user's hooks and plugins ran in her session, and the
  // developer's auto-memory for this repo was loaded into her context.
  assert.equal(args[args.indexOf('--setting-sources') + 1], 'project');
  assert.deepEqual(JSON.parse(args[args.indexOf('--settings') + 1]), { autoMemoryEnabled: false });
});

test('args: her tools run without a prompt; Read is her only built-in, for opening a screenshot', () => {
  const args = claudeArgs({ engine: { command: 'node', args: [] } });

  assert.equal(args[args.indexOf('--tools') + 1], 'Read');
  const allowed = args[args.indexOf('--allowedTools') + 1];
  assert.match(allowed, /mcp__avelyn-engine/);
  assert.match(allowed, /\bRead\b/);
});

test('args: folders she must read outside her home (the screenshots) are added', () => {
  const args = claudeArgs({ engine: { command: 'node', args: [] }, readDirs: ['C:/Jane Doe/captures'] });
  assert.equal(args[args.indexOf('--add-dir') + 1], 'C:/Jane Doe/captures');
});

test('args: model and resume only when given', () => {
  const bare = claudeArgs({ engine: { command: 'node', args: [] } });
  assert.equal(bare.includes('--model'), false);
  assert.equal(bare.includes('--resume'), false);

  const full = claudeArgs({ engine: { command: 'node', args: [] }, model: 'sonnet', resume: 'sess-7' });
  assert.equal(full[full.indexOf('--model') + 1], 'sonnet');
  assert.equal(full[full.indexOf('--resume') + 1], 'sess-7');
});

test('reports the model Claude says it is running, replacing the alias it was asked for', async () => {
  const child = fakeChild();
  const spawn: SpawnFn = () => child as unknown as ChildLike;
  const s = new Session({ command: 'claude', args: [], dialect: claudeDialect(), spawn, model: 'sonnet' });
  assert.equal(s.model, 'sonnet', 'what was asked for, until Claude says');

  const reply = s.ask('hi');
  child.stdout.emit('data', line({ type: 'system', subtype: 'init', session_id: 's1', model: 'claude-sonnet-5-5' }));
  child.stdout.emit('data', result('hey'));
  await reply;
  assert.equal(s.model, 'claude-sonnet-5-5');
});

const toolStart = (name: string, index = 1) =>
  line({ type: 'stream_event', event: { type: 'content_block_start', index, content_block: { type: 'tool_use', name, input: {} } } });

// Seen live 2026-10-20: Claude wrote her line, called speak, then narrated what
// it had done — and the bubble showed the narration instead of the line.
test('the subtitle is the line written before her voice call, not the narration after it', async () => {
  const { child, session: s } = session();
  const seen: string[] = [];
  const reply = s.ask('what are you doing', { onText: (text) => seen.push(text) });

  child.stdout.emit('data', messageStart());
  child.stdout.emit('data', textDelta('Nothing much.'));
  child.stdout.emit('data', toolStart('mcp__avelyn-engine__speak'));
  child.stdout.emit('data', messageStart());
  child.stdout.emit('data', textDelta('I answered out loud too.'));
  child.stdout.emit('data', result('I answered out loud too.'));

  assert.equal(await reply, 'Nothing much.');
  assert.deepEqual(seen, ['Nothing much.'], 'the narration never reaches the bubble, even mid-stream');
});

test('react counts as her voice call too; other tools do not', async () => {
  const { child, session: s } = session();
  const reply = s.ask('hi', { onText: () => {} });

  child.stdout.emit('data', messageStart());
  child.stdout.emit('data', textDelta('Let me check.'));
  child.stdout.emit('data', toolStart('mcp__avelyn-engine__recall_facts'));
  child.stdout.emit('data', messageStart());
  child.stdout.emit('data', textDelta('You play Minecraft.'));
  child.stdout.emit('data', toolStart('mcp__avelyn-engine__react'));
  child.stdout.emit('data', messageStart());
  child.stdout.emit('data', textDelta('Reacted and spoke.'));
  child.stdout.emit('data', result('Reacted and spoke.'));

  assert.equal(await reply, 'You play Minecraft.');
});

test('an unprompted turn (no subtitle callback) still gets the line before the voice call', async () => {
  const { child, session: s } = session();
  const reply = s.ask('[glance] ...');

  child.stdout.emit('data', messageStart());
  child.stdout.emit('data', textDelta('Nice tabs.'));
  child.stdout.emit('data', toolStart('mcp__avelyn-engine__speak'));
  child.stdout.emit('data', messageStart());
  child.stdout.emit('data', textDelta('Said it out loud.'));
  child.stdout.emit('data', result('Said it out loud.'));

  assert.equal(await reply, 'Nice tabs.');
});

const assistantToolUse = (name: string, input: Record<string, unknown>) =>
  line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name, input }] } });

// Seen live 2026-10-20: after look (or recall) she went straight to speak with
// no English line first, then wrote "Spoken." — which the bubble showed.
test('with no line before her voice call, the subtitle is what she spoke — never the narration after', async () => {
  const { child, session: s } = session();
  const seen: string[] = [];
  const reply = s.ask('what do you see', { onText: (text) => seen.push(text) });

  child.stdout.emit('data', messageStart());
  child.stdout.emit('data', toolStart('mcp__avelyn-engine__speak'));
  child.stdout.emit('data', assistantToolUse('mcp__avelyn-engine__speak', { text: '見えたよ。' }));
  child.stdout.emit('data', messageStart());
  child.stdout.emit('data', textDelta('Spoken.'));
  child.stdout.emit('data', result('Spoken.'));

  assert.equal(await reply, '見えたよ。');
  assert.deepEqual(seen, ['見えたよ。']);
});

test('react\'s spoken line is its speechText', async () => {
  const { child, session: s } = session();
  const reply = s.ask('hi');

  child.stdout.emit('data', messageStart());
  child.stdout.emit('data', toolStart('mcp__avelyn-engine__react'));
  child.stdout.emit('data', assistantToolUse('mcp__avelyn-engine__react', { action: 'laugh', speechText: 'ははっ。' }));
  child.stdout.emit('data', messageStart());
  child.stdout.emit('data', textDelta('Reacted.'));
  child.stdout.emit('data', result('Reacted.'));

  assert.equal(await reply, 'ははっ。');
});

test('a line written before the voice call still wins over the spoken one', async () => {
  const { child, session: s } = session();
  const reply = s.ask('hi', { onText: () => {} });

  child.stdout.emit('data', messageStart());
  child.stdout.emit('data', textDelta('Evening.'));
  child.stdout.emit('data', toolStart('mcp__avelyn-engine__speak'));
  child.stdout.emit('data', assistantToolUse('mcp__avelyn-engine__speak', { text: 'こんばんは。' }));
  child.stdout.emit('data', result('Spoken.'));

  assert.equal(await reply, 'Evening.');
});
