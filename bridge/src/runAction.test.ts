import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAction } from './runAction.ts';

const config = { baseUrl: 'http://x', token: 'tok' };
const fastReset = { pollIntervalMs: 5, pollTimeoutMs: 50, expressionOnlyHoldMs: 10 };

// A fixed sleep guessing how long a background reset task takes is exactly
// the kind of timing assumption that broke under CPU contention (running the
// whole suite together took noticeably longer per test than running one file
// alone) — poll for the actual condition instead of guessing a duration.
function waitFor(check: () => boolean, timeoutMs = 2000): Promise<void> {
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

test('runAction returns unknown-action for an unmapped id', async () => {
  const result = await runAction(config, 'not_real');
  assert.equal(result.ok, false);
  assert.equal(result.step, 'unknown-action');
});

test('skipExpression fires only the animation, with no expression.set and no auto-reset', async (t) => {
  const calls: Array<{ command: string; payload: unknown }> = [];
  t.mock.method(globalThis, 'fetch', async (url: unknown, init?: RequestInit) => {
    if (typeof url === 'string' && url.endsWith('/v1/command')) {
      const body = JSON.parse(init?.body as string);
      calls.push(body);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true, current: { overlay: null } }), { status: 200 });
  });

  const result = await runAction(config, 'greet', fastReset, { skipExpression: true });

  assert.equal(result.ok, true);
  assert.equal(result.expression, undefined);
  assert.equal(result.autoReset, false);
  assert.deepEqual(
    calls.map((c) => c.command),
    ['animation.play'],
  );

  // Nothing was scheduled to reset — give a background task a chance to prove
  // that wrong before the mock unmounts, rather than just trusting silence.
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(calls.length, 1);
});

test('skipExpression on an expression-only action makes no bus calls at all, but still succeeds', async (t) => {
  const calls: Array<{ command: string; payload: unknown }> = [];
  t.mock.method(globalThis, 'fetch', async (url: unknown, init?: RequestInit) => {
    if (typeof url === 'string' && url.endsWith('/v1/command')) {
      const body = JSON.parse(init?.body as string);
      calls.push(body);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true, current: { overlay: null } }), { status: 200 });
  });

  // 'scold' has no animationId — with skipExpression there is nothing left to fire.
  const result = await runAction(config, 'scold', fastReset, { skipExpression: true });

  assert.equal(result.ok, true);
  assert.equal(result.animation, undefined);
  assert.deepEqual(calls, []);
});

test('runAction sets expression then plays animation once, and returns before the reset finishes', async (t) => {
  const calls: Array<{ command: string; payload: unknown }> = [];
  t.mock.method(globalThis, 'fetch', async (url: unknown, init?: RequestInit) => {
    if (typeof url === 'string' && url.endsWith('/v1/command')) {
      const body = JSON.parse(init?.body as string);
      calls.push(body);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true, current: { overlay: null } }), { status: 200 });
  });

  const result = await runAction(config, 'greet', fastReset);

  assert.equal(result.ok, true);
  assert.equal(result.autoReset, true);
  assert.deepEqual(
    calls.map((c) => c.command),
    ['expression.set', 'animation.play'],
  );
  assert.deepEqual(calls[1].payload, { id: 'Greeting', mode: 'once' });

  // The mock's overlay is always null, so waitForOverlayClear now correctly
  // polls out the full timeout (never having seen it active) before the
  // background reset gives up — let it finish before the mock unmounts.
  await waitFor(() => calls.length >= 3);
});

test('runAction stops before animation.play if expression.set fails', async (t) => {
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(init?.body as string);
    calls.push(body.command);
    return new Response(JSON.stringify({ ok: false, error: 'nope' }), { status: 200 });
  });

  const result = await runAction(config, 'greet', fastReset);

  assert.deepEqual(calls, ['expression.set']);
  assert.equal(result.ok, false);
  assert.equal(result.step, 'expression');
});

test('a paired action clears the expression once /v1/state reports the overlay gone', async (t) => {
  const calls: Array<{ command: string; payload: unknown }> = [];
  let overlayReported = false; // the renderer hasn't caught up and reported the new overlay yet
  let overlayCleared = false;
  t.mock.method(globalThis, 'fetch', async (url: unknown, init?: RequestInit) => {
    if (typeof url === 'string' && url.endsWith('/v1/command')) {
      const body = JSON.parse(init?.body as string);
      calls.push(body);
      if (body.command === 'animation.play') {
        // Real clips take a few polls before finishing; the overlay first has
        // to be *seen* active (simulating the renderer's own report catching
        // up) before it can clear.
        setTimeout(() => (overlayReported = true), 5);
        setTimeout(() => (overlayCleared = true), 20);
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    const overlay = overlayReported && !overlayCleared ? { animationId: 'vrma-02' } : null;
    return new Response(JSON.stringify({ ok: true, current: { overlay } }), { status: 200 });
  });

  await runAction(config, 'greet', fastReset);
  await waitFor(() => calls.length >= 3);

  const resetCall = calls.find((c, i) => i === 2);
  assert.equal(resetCall?.command, 'expression.set');
  assert.deepEqual(resetCall?.payload, { id: 'happy', weight: 0 });
});

test('does not clear the expression on the first poll just because the overlay has not been reported yet', async (t) => {
  // Regression test for a real bug: the first /v1/state poll routinely lands
  // before the renderer has reported the overlay it was just told to start
  // (see waitForOverlayClear's comment), which used to read as "already
  // finished" and clear the expression within ~100ms — a visible flash
  // instead of a held gesture.
  const calls: Array<{ command: string; payload: unknown }> = [];
  let pollCount = 0;
  t.mock.method(globalThis, 'fetch', async (url: unknown, init?: RequestInit) => {
    if (typeof url === 'string' && url.endsWith('/v1/command')) {
      const body = JSON.parse(init?.body as string);
      calls.push(body);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    pollCount += 1;
    // Stale on the very first poll (as if the renderer hasn't reported the
    // new overlay yet), active from the second poll on, then clears.
    const overlay = pollCount === 1 || pollCount >= 4 ? null : { animationId: 'vrma-02' };
    return new Response(JSON.stringify({ ok: true, current: { overlay } }), { status: 200 });
  });

  // A generous poll budget of its own, not the shared fastReset: this test
  // needs several real polls to land before it times out, and mock/runner
  // overhead per fetch call can eat into a tight window on a slow machine.
  await runAction(config, 'greet', { pollIntervalMs: 5, pollTimeoutMs: 500, expressionOnlyHoldMs: 10 });
  await waitFor(() => calls.length >= 3);

  const resetCall = calls.find((c, i) => i === 2);
  assert.equal(resetCall?.command, 'expression.set');
  assert.ok(pollCount >= 4, 'should have kept polling through the stale first read instead of clearing immediately');
});

test('an expression-only action clears after the fixed hold, with no animation.play call', async (t) => {
  const calls: Array<{ command: string; payload: unknown }> = [];
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(init?.body as string);
    calls.push(body);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });

  const result = await runAction(config, 'scold', fastReset);
  assert.equal(result.animation, undefined);

  await waitFor(() => calls.length >= 2); // let the background hold+reset run

  assert.deepEqual(
    calls.map((c) => c.command),
    ['expression.set', 'expression.set'],
  );
  assert.deepEqual(calls[1].payload, { id: 'angry', weight: 0 });
});

test('idle_calm moves nothing — expression only, no animation.play', async (t) => {
  // idle_calm used to point at `combo-idle-calm`, which is a *single-pose*
  // combo (poseSequences.js): 0.7s fading into Pose 04, ~0.45s held, then
  // reverted. No gesture content, and Pose 04 is already in the ambient Pose
  // Cycle's pool — so invoking it read as the avatar twitching to a pose she
  // was going to drift into anyway, then jerking out of it. Worse, starting
  // that overlay bumps the shared `requestGeneration` (useVrmAnimation.js) and
  // kills the cycle's pending advance timer, so the ambient idle restarted
  // from a fresh shuffle. "Composed resting stance" is the idle state itself —
  // it should not move the body at all.
  const calls: Array<{ command: string; payload: unknown }> = [];
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(init?.body as string);
    calls.push(body);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });

  const result = await runAction(config, 'idle_calm', fastReset);
  assert.equal(result.animation, undefined);

  await waitFor(() => calls.length >= 2); // let the background hold+reset run

  assert.deepEqual(
    calls.map((c) => c.command),
    ['expression.set', 'expression.set'],
  );
  assert.deepEqual(calls[0].payload, { id: 'relaxed', weight: 1 });
});

// The Pose Library is not redistributable, so a public copy has no combos:
// a gesture built on one must fall back to the face, not fail the reaction.
test('an animation the stage does not have falls back to expression-only, and still succeeds', async (t) => {
  const calls: Array<{ command: string; payload: unknown }> = [];
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(init?.body as string);
    calls.push(body);
    if (body.command === 'animation.play') {
      return new Response(JSON.stringify({ ok: false, code: 'unknown-animation', error: 'No animation matches "combo-think".' }), { status: 400 });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });

  const result = await runAction(config, 'think', fastReset);
  assert.equal(result.ok, true);
  assert.equal(result.animationUnavailable, true);

  await waitFor(() => calls.length >= 3); // the expression-only hold, then the reset
  assert.deepEqual(calls.map((c) => c.command), ['expression.set', 'animation.play', 'expression.set']);
  assert.deepEqual(calls[2].payload, { id: 'relaxed', weight: 0 });
});

test('any other animation failure still fails the action', async (t) => {
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(init?.body as string);
    if (body.command === 'animation.play') {
      return new Response(JSON.stringify({ ok: false, code: 'stage-unavailable', error: 'The stage is not ready.' }), { status: 503 });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });

  const result = await runAction(config, 'think', fastReset);
  assert.equal(result.ok, false);
  assert.equal(result.step, 'animation');
});
