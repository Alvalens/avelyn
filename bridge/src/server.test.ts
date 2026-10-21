import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createServer } from './server.ts';

const config = { baseUrl: 'http://x', token: 'tok' };

// A fixed sleep guessing how long a background reset task takes doesn't hold
// up under CPU contention — poll for the actual condition instead.
function waitFor(check: () => boolean, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const tick = () => {
      if (check()) return resolve();
      if (Date.now() > deadline) return reject(new Error('waitFor: condition never became true'));
      setTimeout(tick, 5);
    };
    tick();
  });
}

function portOf(server: ReturnType<typeof createServer>): number {
  const address = server.address();
  if (address && typeof address === 'object') return (address as AddressInfo).port;
  throw new Error('server has no port');
}

test('GET /actions lists the personality action catalog', async (t) => {
  const server = createServer(config);
  server.listen(0);
  t.after(() => server.close());
  const port = portOf(server);

  const res = await fetch(`http://127.0.0.1:${port}/actions`);
  const body = (await res.json()) as Array<{ id: string }>;

  assert.equal(res.status, 200);
  assert.ok(body.some((action) => action.id === 'greet'));
});

test('POST /actions/:id runs the action and proxies the bus result', async (t) => {
  const originalFetch = globalThis.fetch;
  let commandCalls = 0;
  let statePolls = 0;
  t.mock.method(globalThis, 'fetch', async (url: unknown, init?: RequestInit) => {
    if (typeof url === 'string' && url.includes('/v1/command')) {
      commandCalls += 1;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    if (typeof url === 'string' && url.includes('/v1/state')) {
      statePolls += 1;
      // Active on the first poll, then clear — waitForOverlayClear (see
      // runAction.ts) now correctly refuses to treat an *immediate* null
      // reading as "already finished", since that's what a stale pre-report
      // snapshot looks like too. This uses production timing (no resetOptions
      // override on the real HTTP route), so it only needs to survive one
      // real poll interval, not simulate a full clip.
      const overlay = statePolls === 1 ? { animationId: 'Greeting' } : null;
      return new Response(JSON.stringify({ ok: true, current: { overlay } }), { status: 200 });
    }
    return originalFetch(url as string, init);
  });

  const server = createServer(config);
  server.listen(0);
  t.after(() => server.close());
  const port = portOf(server);

  const res = await fetch(`http://127.0.0.1:${port}/actions/greet`, { method: 'POST' });
  const body = (await res.json()) as { ok: boolean; actionId: string };

  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.actionId, 'greet');

  // Let the background reset (production timing: 250ms poll interval) finish
  // before this test's mock unmounts. 3, not 2: expression.set + animation.play
  // are the first two /v1/command calls runAction makes up front — the third
  // is the reset's own expression.set(weight: 0), which is the one actually
  // gated on the overlay-clear poll above.
  await waitFor(() => commandCalls >= 3, 5000);
});

test('POST /actions/:id returns 502 for an unknown action', async (t) => {
  const server = createServer(config);
  server.listen(0);
  t.after(() => server.close());
  const port = portOf(server);

  const res = await fetch(`http://127.0.0.1:${port}/actions/not_real`, { method: 'POST' });
  const body = (await res.json()) as { ok: boolean };

  assert.equal(res.status, 502);
  assert.equal(body.ok, false);
});
