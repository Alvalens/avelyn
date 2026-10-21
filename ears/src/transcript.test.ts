import { test } from 'node:test';
import assert from 'node:assert/strict';
import { correctTranscript, looksLikeSilence, parseTranscript, SPEECH_PEAK } from './transcript.ts';

// Real captured stdout, byte-for-byte: a leading blank line, then each segment
// prefixed with a single space. This is the actual shape, not a guess.
const REAL_STDOUT = '\n Hey Avelyn, what are you working on right now?\n';
const SILENCE_STDOUT = '\n You\n';

test('strips the leading blank line and per-segment space', () => {
  assert.equal(parseTranscript(REAL_STDOUT), 'Hey Avelyn, what are you working on right now?');
});

test('joins multiple segment lines into one transcript', () => {
  const stdout = '\n I spent three hours on it.\n Turned out to be off by one.\n';
  assert.equal(parseTranscript(stdout), 'I spent three hours on it. Turned out to be off by one.');
});

test('empty or whitespace-only output is an empty transcript', () => {
  assert.equal(parseTranscript(''), '');
  assert.equal(parseTranscript('\n'), '');
  assert.equal(parseTranscript('  \n \n'), '');
});

test('keeps interior punctuation and casing untouched', () => {
  assert.equal(parseTranscript('\n Off by one, in the pagination logic.\n'),
    'Off by one, in the pagination logic.');
});

// The guard has to fire on whisper's silence hallucinations, but "You" is also
// a word a person genuinely says. So it may only match a WHOLE transcript —
// the moment it starts matching substrings it starts eating real sentences.
test('treats a whole-transcript hallucination as silence', () => {
  for (const hallucination of ['You', 'you', 'Thank you.', 'Thanks for watching!', '[BLANK_AUDIO]', '(silence)']) {
    assert.equal(looksLikeSilence(hallucination), true, `should be silence: ${hallucination}`);
  }
});

test('an empty transcript is silence', () => {
  assert.equal(looksLikeSilence(''), true);
});

test('never fires on real speech that merely contains a hallucination word', () => {
  for (const real of [
    'You were right about the pagination bug',
    'I think you should check it',
    'thank you for looking at that',
    'Thanks, that fixed it',
  ]) {
    assert.equal(looksLikeSilence(real), false, `should be speech: ${real}`);
  }
});

test('is case- and padding-insensitive when matching', () => {
  assert.equal(looksLikeSilence('  YOU  '), true);
  assert.equal(looksLikeSilence('Thank You.'), true);
});

// "Thank you" and "bye" are whisper's favourite things to hallucinate over
// silence — and also exactly what a person says to her. The recording's raw
// peak (measured before the HUD's gain) is what tells the two apart.
test('a hallucination phrase over a quiet recording is still silence', () => {
  assert.equal(looksLikeSilence('Thank you.', 0), true);
  assert.equal(looksLikeSilence('Bye.', SPEECH_PEAK / 2), true);
});

test('the same phrase over a recording with real signal is speech', () => {
  for (const phrase of ['Thank you.', 'Bye.', 'You']) {
    assert.equal(looksLikeSilence(phrase, 0.3), false, `should be speech: ${phrase}`);
  }
});

test('without a level the hallucination list keeps its old meaning', () => {
  assert.equal(looksLikeSilence('Thank you.'), true);
});

test('an empty transcript is silence however loud the recording was', () => {
  assert.equal(looksLikeSilence('', 0.9), true);
});

// Prompting whisper with her name made it skip a spoken "Hi Avelyn." outright
// (it treats prompt text as already said), and every prompt that did not end
// in the name still produced "Evelyn" — measured 2026-10-05. So the name is
// fixed after the fact instead.
test('her name is corrected from what whisper actually hears', () => {
  assert.equal(correctTranscript('Hi Evelyn. Can you hear me?'), 'Hi Avelyn. Can you hear me?');
  assert.equal(correctTranscript("evelyn, what's Evelyn's take?"), "Avelyn, what's Avelyn's take?");
});

test('correction only replaces whole words', () => {
  assert.equal(correctTranscript('Evelynne and Bevelyn'), 'Evelynne and Bevelyn');
});

test('extra corrections can be supplied', () => {
  assert.equal(correctTranscript('open voice vox', { 'voice vox': 'VOICEVOX' }), 'open VOICEVOX');
});
