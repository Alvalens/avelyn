import { test } from 'node:test';
import assert from 'node:assert/strict';
import { greetingPrompt } from './greeting.ts';

const MONDAY_EVENING = new Date(2026, 9, 5, 19, 40);

test('is marked as a launch note, not something the user said', () => {
  const prompt = greetingPrompt(MONDAY_EVENING);
  assert.ok(prompt.startsWith('[launch]'), prompt);
  assert.match(prompt, /not something (they|the user) said/i);
});

test('carries the local day, date and time so she can greet for the hour', () => {
  const prompt = greetingPrompt(MONDAY_EVENING);
  assert.match(prompt, /Monday/);
  assert.match(prompt, /5 October/);
  assert.match(prompt, /19:40/);
});

test('asks for one short spoken line', () => {
  const prompt = greetingPrompt(MONDAY_EVENING);
  assert.match(prompt, /one short line/i);
  assert.match(prompt, /out loud/i);
});

test('lists what she already knows about the user, so a greeting can use it without a lookup', () => {
  const prompt = greetingPrompt(MONDAY_EVENING, [
    'Plays Minecraft for gaming downtime.',
    "Doesn't drink caffeine; prefers water.",
  ]);
  assert.match(prompt, /- Plays Minecraft for gaming downtime\./);
  assert.match(prompt, /- Doesn't drink caffeine; prefers water\./);
});

test('says plainly when she knows nothing yet, rather than leaving her to guess', () => {
  const prompt = greetingPrompt(MONDAY_EVENING, []);
  assert.match(prompt, /nothing about them yet/i);
});

test('tells her the greeting itself is not worth remembering', () => {
  const prompt = greetingPrompt(MONDAY_EVENING);
  assert.match(prompt, /don't (log|note|remember) (the|this) greeting/i);
});

test('asks for the English line first, then the voice — the bubble shows the line written before it', () => {
  const prompt = greetingPrompt(MONDAY_EVENING);
  assert.match(prompt, /write (it|the line) in English first/i);
});
