import { test } from 'node:test';
import assert from 'node:assert/strict';
import { foreground, parseForeground } from './foreground.ts';

test('parses the JSON the script prints', () => {
  assert.deepEqual(
    parseForeground('{"process":"Code","title":"poseSequences.js - Avelyn"}\r\n'),
    { process: 'Code', title: 'poseSequences.js - Avelyn' },
  );
});

test('a window with no title is still a window', () => {
  assert.deepEqual(parseForeground('{"process":"explorer","title":""}'), { process: 'explorer', title: '' });
});

test('anything unparseable, or with no process, is null', () => {
  assert.equal(parseForeground(''), null);
  assert.equal(parseForeground('not json'), null);
  assert.equal(parseForeground('{"process":"","title":"x"}'), null);
  assert.equal(parseForeground('{"title":"x"}'), null);
  assert.equal(parseForeground('null'), null);
});

test('foreground() is null when PowerShell itself fails', async () => {
  const result = await foreground(async () => {
    throw new Error('spawn failed');
  });
  assert.equal(result, null);
});

test('foreground() returns what the runner printed', async () => {
  const result = await foreground(async () => '{"process":"chrome","title":"Docs"}');
  assert.deepEqual(result, { process: 'chrome', title: 'Docs' });
});
