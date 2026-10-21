import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { homePath, preparePersona } from './home.ts';

test('her home is in the per-user avelyn folder, outside any repo', () => {
  assert.equal(homePath({ LOCALAPPDATA: 'C:\\L' }), join('C:\\L', 'avelyn', 'home'));
  assert.equal(homePath({ LOCALAPPDATA: 'C:\\L', AVELYN_HOME: 'D:\\h' }), 'D:\\h');
});

test('preparePersona copies persona/AGENTS.md into her home, and refreshes it every start', () => {
  const root = mkdtempSync(join(tmpdir(), 'avelyn repo '));
  mkdirSync(join(root, 'persona'));
  writeFileSync(join(root, 'persona', 'AGENTS.md'), '# Avelyn v1');
  const home = join(mkdtempSync(join(tmpdir(), 'avelyn-home-')), 'nested', 'home');

  assert.equal(preparePersona(home, root), home);
  assert.equal(readFileSync(join(home, 'AGENTS.md'), 'utf8'), '# Avelyn v1');

  writeFileSync(join(root, 'persona', 'AGENTS.md'), '# Avelyn v2');
  preparePersona(home, root);
  assert.equal(readFileSync(join(home, 'AGENTS.md'), 'utf8'), '# Avelyn v2');
});

test('the persona in this repo is where preparePersona looks for it', async () => {
  const { REPO_ROOT } = await import('./config.ts');
  assert.match(readFileSync(join(REPO_ROOT, 'persona', 'AGENTS.md'), 'utf8'), /You are \*\*Avelyn\*\*/);
});
