const assert = require('node:assert/strict');
const test = require('node:test');
const {
  DEFAULT_VOICE_HOTKEY,
  gestureFor,
  normalizeVoiceSettings,
  parsePipelineLine,
  stateForPipelineEvent,
  voiceDiagnosticFromArgv,
} = require('./voice-hud-logic.cjs');

test('normalizeVoiceSettings matches the renderer rules', () => {
  assert.deepEqual(normalizeVoiceSettings(null), {
    enabled: true, hotkey: DEFAULT_VOICE_HOTKEY, micLabel: '', autoStop: true,
  });
  assert.equal(normalizeVoiceSettings({ autoStop: false }).autoStop, false);
  assert.equal(normalizeVoiceSettings({ autoStop: 'no' }).autoStop, true);
  assert.equal(normalizeVoiceSettings({ enabled: 'false' }).enabled, true);
  assert.equal(normalizeVoiceSettings({ enabled: false }).enabled, false);
  assert.equal(normalizeVoiceSettings({ hotkey: '  ' }).hotkey, DEFAULT_VOICE_HOTKEY);
  assert.equal(normalizeVoiceSettings({ hotkey: ' Alt+V ' }).hotkey, 'Alt+V');
  assert.equal(normalizeVoiceSettings({ micLabel: ' Realtek ' }).micLabel, 'Realtek');
  assert.equal(normalizeVoiceSettings({ micLabel: 7 }).micLabel, '');
});

test('parsePipelineLine keeps objects and drops everything else', () => {
  assert.deepEqual(parsePipelineLine('{"type":"ready"}'), { type: 'ready' });
  assert.equal(parsePipelineLine(''), null);
  assert.equal(parsePipelineLine('   '), null);
  // Diagnostics a child prints to stdout must not crash the reader.
  assert.equal(parsePipelineLine('whisper_init: loading'), null);
  assert.equal(parsePipelineLine('5'), null);
  assert.equal(parsePipelineLine('null'), null);
});

test('ready puts the bubble at rest and marks the pipeline up', () => {
  assert.deepEqual(stateForPipelineEvent({ type: 'ready' }), {
    hud: { state: 'idle' }, ready: true,
  });
});

test('a transcript is shown while she thinks, and the turn is not over', () => {
  const outcome = stateForPipelineEvent({ type: 'transcript', text: 'hi Avelyn' });
  assert.deepEqual(outcome.hud, { state: 'thinking', transcript: 'hi Avelyn' });
  assert.equal(outcome.done, undefined);
  assert.equal(outcome.log, '[heard] "hi Avelyn"');
});

test('silent, reply and error each end the turn', () => {
  assert.deepEqual(stateForPipelineEvent({ type: 'silent' }).hud,
    { state: 'idle', note: "didn't catch that" });
  assert.deepEqual(stateForPipelineEvent({ type: 'reply', text: 'Good.' }).hud,
    { state: 'reply', text: 'Good.' });
  assert.deepEqual(stateForPipelineEvent({ type: 'error', message: 'boom' }).hud,
    { state: 'error', message: 'boom' });
  for (const type of ['silent', 'reply', 'error']) {
    assert.equal(stateForPipelineEvent({ type, text: '', message: '' }).done, true, type);
  }
});

test('unknown or missing events change nothing', () => {
  assert.equal(stateForPipelineEvent({ type: 'mystery' }), null);
  assert.equal(stateForPipelineEvent(null), null);
});

test('voiceDiagnosticFromArgv picks the one-shot mic checks', () => {
  assert.equal(voiceDiagnosticFromArgv(['electron', '.', '--list-mics']), 'list-mics');
  assert.equal(voiceDiagnosticFromArgv(['electron', '.', '--mic-test']), 'mic-test');
  assert.equal(voiceDiagnosticFromArgv(['electron', '.', '--capture-test']), 'capture-test');
  assert.equal(voiceDiagnosticFromArgv(['electron', '.']), null);
});

test('the launch greeting shows her thinking, without a transcript, and is not a finished turn', () => {
  const outcome = stateForPipelineEvent({ type: 'greeting' });
  assert.deepEqual(outcome.hud, { state: 'thinking' });
  assert.equal(outcome.done, undefined);
});

test('she holds a listening pose while you talk, then a thinking pose until she answers', () => {
  assert.deepEqual(gestureFor('listening'), {
    command: 'animation.play', payload: { id: 'combo-listening', mode: 'hold' },
  });
  assert.deepEqual(gestureFor('thinking'), {
    command: 'animation.play', payload: { id: 'combo-think', mode: 'hold' },
  });
});

test('a finished turn releases whatever pose is held', () => {
  // Release, not stop: if her reply came with its own gesture, that gesture
  // has already replaced the held pose and must be left to finish.
  assert.deepEqual(gestureFor('settled'), { command: 'animation.release' });
  assert.equal(gestureFor('anything-else'), null);
});

test('an unprompted remark shows as a reply but does not end a turn', () => {
  const outcome = stateForPipelineEvent({ type: 'remark', text: 'Still at it.' });
  assert.deepEqual(outcome.hud, { state: 'reply', text: 'Still at it.' });
  // `done` would clear `busy` and release the pose of a turn the user may be in.
  assert.equal(outcome.done, undefined);
  assert.match(outcome.log, /remark/);
});

test('an unprompted remark is held back while the user is recording or mid-turn', () => {
  const { shouldShowRemark } = require('./voice-hud-logic.cjs');
  assert.equal(shouldShowRemark({ listening: false, busy: false }), true);
  assert.equal(shouldShowRemark({ listening: true, busy: false }), false);
  assert.equal(shouldShowRemark({ listening: false, busy: true }), false);
});

test('streamed text shows as a reply but ends nothing and logs nothing', () => {
  const outcome = stateForPipelineEvent({ type: 'partial', text: 'Hello th' });
  assert.deepEqual(outcome.hud, { state: 'reply', text: 'Hello th' });
  // `done` would clear `busy` and release the held pose while she is still working.
  assert.equal(outcome.done, undefined);
  assert.equal(outcome.log, undefined);
});

test('streamed text is dropped while the user is recording', () => {
  const { shouldShowPartial } = require('./voice-hud-logic.cjs');
  assert.equal(shouldShowPartial({ listening: false }), true);
  assert.equal(shouldShowPartial({ listening: true }), false);
});

const { normalizeBrainSettings, pipelineEnv } = require('./voice-hud-logic.cjs');

test('normalizeBrainSettings matches the renderer rules (src/config/brain.js)', () => {
  assert.deepEqual(normalizeBrainSettings(null), { provider: 'agy', model: '' });
  assert.deepEqual(normalizeBrainSettings({ provider: 'claude', model: ' sonnet ' }), { provider: 'claude', model: 'sonnet' });
  assert.deepEqual(normalizeBrainSettings({ provider: 'skynet', model: 'x' }), { provider: 'agy', model: '' });
  assert.deepEqual(normalizeBrainSettings({ provider: 'codex', model: 7 }), { provider: 'codex', model: '' });
});

test('pipelineEnv hands the brain to ears/src/config.ts, and a resume id only when there is one', () => {
  assert.deepEqual(pipelineEnv({ provider: 'codex', model: 'gpt-x' }, null), {
    AVELYN_BRAIN: 'codex', AVELYN_BRAIN_MODEL: 'gpt-x', AVELYN_RESUME: '',
  });
  assert.equal(pipelineEnv({ provider: 'agy', model: '' }, 'conv-1').AVELYN_RESUME, 'conv-1');
});

test('a session event is remembered by main, and shows nothing in the bubble', () => {
  const outcome = stateForPipelineEvent({ type: 'session', id: 'sess-7' });
  assert.equal(outcome.session, 'sess-7');
  assert.equal(outcome.hud, undefined);
  assert.equal(outcome.done, undefined, 'it ends no turn');
});

const { brainLabel } = require('./voice-hud-logic.cjs');

test('a brain event is kept by main and labelled for the bubble', () => {
  const outcome = stateForPipelineEvent({ type: 'brain', provider: 'claude', model: 'claude-sonnet-5-5' });
  assert.deepEqual(outcome.brain, { provider: 'claude', model: 'claude-sonnet-5-5' });
  assert.equal(outcome.hud, undefined);
  assert.equal(outcome.done, undefined, 'it ends no turn');
});

test('brainLabel: the CLI, and the model when it is known', () => {
  assert.equal(brainLabel({ provider: 'claude', model: 'claude-sonnet-5-5' }), 'claude · claude-sonnet-5-5');
  assert.equal(brainLabel({ provider: 'agy', model: 'Gemini 3.8 Flash (Medium)' }), 'agy · Gemini 3.8 Flash (Medium)');
  assert.equal(brainLabel({ provider: 'codex', model: null }), 'codex');
  assert.equal(brainLabel(null), '');
});
