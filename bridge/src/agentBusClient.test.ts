import { test } from 'node:test';
import assert from 'node:assert/strict';
import { postCommand } from './agentBusClient.ts';

test('postCommand sends bearer token and command body', async (t) => {
  let capturedUrl: unknown;
  let capturedInit: RequestInit | undefined;
  t.mock.method(globalThis, 'fetch', async (url: unknown, init?: RequestInit) => {
    capturedUrl = url;
    capturedInit = init;
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });

  const result = await postCommand({ baseUrl: 'http://x', token: 'tok' }, 'expression.set', { id: 'happy' });

  assert.equal(capturedUrl, 'http://x/v1/command');
  assert.equal((capturedInit?.headers as Record<string, string>).Authorization, 'Bearer tok');
  assert.deepEqual(JSON.parse(capturedInit?.body as string), {
    command: 'expression.set',
    payload: { id: 'happy' },
  });
  assert.deepEqual(result, { ok: true });
});

test('postCommand surfaces non-ok HTTP responses as ok:false', async (t) => {
  t.mock.method(
    globalThis,
    'fetch',
    async () => new Response(JSON.stringify({ error: 'bad' }), { status: 400 }),
  );

  const result = await postCommand({ baseUrl: 'http://x', token: 'tok' }, 'expression.set', {});

  assert.equal(result.ok, false);
  assert.equal(result.error, 'bad');
});
