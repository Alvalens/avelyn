import { test } from 'node:test';
import assert from 'node:assert/strict';
import { glancePrompt, isQuiet } from './glance.ts';

const AFTERNOON = new Date(2026, 9, 7, 15, 10);

test('is marked as a glance note, not something the user said', () => {
  const prompt = glancePrompt(AFTERNOON, 35, true);
  assert.ok(prompt.startsWith('[glance]'), prompt);
  assert.match(prompt, /not something (they|the user) said/i);
});

test('carries the time and how long it has been quiet', () => {
  const prompt = glancePrompt(AFTERNOON, 35, true);
  assert.match(prompt, /15:10/);
  assert.match(prompt, /35 minutes/);
});

test('offers look only when she is allowed to look', () => {
  assert.match(glancePrompt(AFTERNOON, 35, true), /call look/i);
  assert.doesNotMatch(glancePrompt(AFTERNOON, 35, false), /call look/i);
});

test('always spells out the way to stay silent', () => {
  assert.match(glancePrompt(AFTERNOON, 35, true), /\[quiet\]/);
  assert.match(glancePrompt(AFTERNOON, 35, false), /\[quiet\]/);
});

test('recognises the ways she says "nothing to say"', () => {
  for (const reply of ['[quiet]', ' [quiet] ', '[Quiet].', '[QUIET]\n', '', '   ']) {
    assert.equal(isQuiet(reply), true, JSON.stringify(reply));
  }
});

test('a real remark is not quiet, even if it mentions the word', () => {
  assert.equal(isQuiet("You've been coding a while."), false);
  assert.equal(isQuiet('It is quiet in here.'), false);
  assert.equal(isQuiet('[quiet] but actually, the build is red'), false);
});

test('a remark is written in English before it is spoken — that line is what the bubble shows', () => {
  assert.match(glancePrompt(new Date(2026, 9, 7, 15, 10), 35, false), /English first/i);
});
