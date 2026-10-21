import assert from 'node:assert/strict';
import test from 'node:test';
import { brainProviders, createDefaultBrain, modelChoices, normalizeBrain } from './brain.js';

test('defaults: agy on its own default model — what every older config already ran', () => {
  assert.deepEqual(createDefaultBrain(), { provider: 'agy', model: '' });
  assert.deepEqual(normalizeBrain(undefined), createDefaultBrain());
  assert.deepEqual(normalizeBrain('claude'), createDefaultBrain());
});

test('keeps a known provider and a trimmed model', () => {
  assert.deepEqual(normalizeBrain({ provider: 'codex', model: ' gpt-5.6-luna ' }), { provider: 'codex', model: 'gpt-5.6-luna' });
  assert.deepEqual(normalizeBrain({ provider: 'claude', model: 'sonnet' }), { provider: 'claude', model: 'sonnet' });
});

test('an unknown provider falls back to agy, and drops a model that belonged to it', () => {
  assert.deepEqual(normalizeBrain({ provider: 'skynet', model: 't-800' }), { provider: 'agy', model: '' });
});

test('every provider has a label for the dropdown', () => {
  assert.deepEqual(brainProviders.map((p) => p.id), ['agy', 'claude', 'codex']);
  for (const p of brainProviders) assert.ok(p.label.length > 0);
});

test('model choices: the CLI default first, then what the CLI listed', () => {
  const listed = [{ id: 'gemini-x', label: 'Gemini X' }];
  assert.deepEqual(modelChoices(listed, ''), [
    { value: '', label: 'CLI default' },
    { value: 'gemini-x', label: 'Gemini X' },
  ]);
});

test('model choices: a model set by hand that the CLI did not list is still shown, not silently dropped', () => {
  const choices = modelChoices([{ id: 'a', label: 'A' }], 'my-custom-model');
  assert.deepEqual(choices.at(-1), { value: 'my-custom-model', label: 'my-custom-model' });
});
