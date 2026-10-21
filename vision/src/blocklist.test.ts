import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockedBy } from './blocklist.ts';
import { DEFAULT_BLOCKLIST } from './settings.ts';

const win = (process: string, title = '') => ({ process, title });

test('matches the process name, ignoring case and .exe', () => {
  assert.equal(blockedBy(win('KeePass.exe'), DEFAULT_BLOCKLIST), 'keepass');
  assert.equal(blockedBy(win('Bitwarden'), DEFAULT_BLOCKLIST), 'bitwarden');
});

test('matches a fragment of the window title', () => {
  assert.equal(blockedBy(win('chrome', 'Gmail - Incognito'), DEFAULT_BLOCKLIST), 'incognito');
  assert.equal(blockedBy(win('msedge', 'Contoso Bank — Accounts'), DEFAULT_BLOCKLIST), 'bank');
});

test('an ordinary window is not blocked', () => {
  assert.equal(blockedBy(win('Code', 'poseSequences.js - Avelyn'), DEFAULT_BLOCKLIST), null);
});

test('an empty or blank entry never matches everything', () => {
  assert.equal(blockedBy(win('Code', 'anything'), ['', '   ']), null);
});

test('an empty blocklist blocks nothing', () => {
  assert.equal(blockedBy(win('KeePass.exe'), []), null);
});
