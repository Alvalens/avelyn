const assert = require('node:assert/strict');
const test = require('node:test');
const { CLAUDE_MODELS, listCommandFor, parseAgyModels, parseCodexModels } = require('./brain-models.cjs');

test('agy: one tab-separated "id<TAB>name" per line, the "Fetching" banner skipped', () => {
  const out = 'Fetching available models...\r\ngemini-4-argon-medium\tGemini 4 Argon (Medium)\r\nclaude-opus-5-5-high\tClaude Opus 5.5 (High)\r\n\r\n';
  assert.deepEqual(parseAgyModels(out), [
    { id: 'gemini-4-argon-medium', label: 'Gemini 4 Argon (Medium)' },
    { id: 'claude-opus-5-5-high', label: 'Claude Opus 5.5 (High)' },
  ]);
});

test('codex: the JSON from `codex debug models`, hidden ones left out, in its own order', () => {
  const out = JSON.stringify({
    models: [
      { slug: 'gpt-reserve', display_name: 'GPT-Reserve', visibility: 'hide', priority: 4 },
      { slug: 'gpt-5.6-luna', display_name: 'GPT-5.6-Luna', visibility: 'list', priority: 9 },
      { slug: 'gpt-5.6-terra', display_name: 'GPT-5.6-Terra', visibility: 'list', priority: 8 },
    ],
  });
  assert.deepEqual(parseCodexModels(out), [
    { id: 'gpt-5.6-terra', label: 'GPT-5.6-Terra' },
    { id: 'gpt-5.6-luna', label: 'GPT-5.6-Luna' },
  ]);
});

test('unparseable output is no models, not a crash', () => {
  assert.deepEqual(parseCodexModels('not json'), []);
  assert.deepEqual(parseAgyModels(''), []);
});

test('claude has no list command; its aliases always follow the latest of each tier', () => {
  assert.deepEqual(CLAUDE_MODELS.map((m) => m.id), ['opus', 'sonnet', 'haiku']);
  assert.equal(listCommandFor('claude'), null);
  assert.equal(listCommandFor('agy'), 'agy models');
  assert.equal(listCommandFor('codex'), 'codex debug models');
  assert.equal(listCommandFor('nope'), null);
});
