import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openMemoryStore } from '../../memory/src/memoryStore.ts';
import type { EngineContext } from './context.ts';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPersonalityAction, remember, recallFacts, listFacts, recallMemories, react, speak, look } from './tools.ts';

const fastReset = { pollIntervalMs: 5, pollTimeoutMs: 50, expressionOnlyHoldMs: 10 };

function testContext(): EngineContext {
  return {
    bus: { baseUrl: 'http://x', token: 'tok' },
    db: openMemoryStore(),
    voice: { baseUrl: 'http://voice.invalid', speakerId: 3 },
    vision: { dir: join(tmpdir(), 'avelyn-engine-test-captures'), settingsPath: join(tmpdir(), 'avelyn-engine-test-missing.json') },
  };
}

// Every mock below reports the overlay as permanently null — none of them
// simulate a real gesture actually being seen active — so a valid action's
// background reset (see bridge/src/runAction.ts's waitForOverlayClear) has to
// poll out its full timeout before it fires its own clearing call. A fixed
// sleep guessing that duration doesn't hold up under CPU contention (running
// the whole suite together takes noticeably longer per test than running one
// file alone) — poll for the actual condition instead.
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

function mockBus(t: import('node:test').TestContext, handler: (command: string, payload: unknown) => unknown) {
  const state = { commandCalls: 0 };
  t.mock.method(globalThis, 'fetch', async (url: unknown, init?: RequestInit) => {
    if (typeof url === 'string' && url.endsWith('/v1/command')) {
      state.commandCalls += 1;
      const body = JSON.parse(init?.body as string);
      return new Response(JSON.stringify(handler(body.command, body.payload)), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true, current: { overlay: null } }), { status: 200 });
  });
  return state;
}

test('runPersonalityAction proxies to bridge and returns its result', async (t) => {
  const ctx = testContext();
  const bus = mockBus(t, () => ({ ok: true }));

  const result = await runPersonalityAction(ctx, 'think', fastReset);
  assert.equal(result.ok, true);
  assert.equal(result.actionId, 'think');

  await waitFor(() => bus.commandCalls >= 3); // let the background reset finish before the mock unmounts
});

test('remember/recallFacts/listFacts round-trip through memory', () => {
  const ctx = testContext();
  remember(ctx, { category: 'preference', content: 'likes dark mode UIs' });
  remember(ctx, { category: 'fact', content: 'lives in a timezone' });

  assert.equal(listFacts(ctx).length, 2);
  assert.equal(listFacts(ctx, 'preference').length, 1);
  assert.equal(recallFacts(ctx, 'dark mode').length, 1);
});

test('recallMemories searches episodes logged elsewhere', async (t) => {
  const ctx = testContext();
  const bus = mockBus(t, () => ({ ok: true }));
  await react(ctx, 'greet', 'said hello for the first time', fastReset);

  const found = recallMemories(ctx, 'hello');
  assert.equal(found.length, 1);
  assert.equal(found[0].category, 'episode');

  await waitFor(() => bus.commandCalls >= 3); // let the background reset finish before the mock unmounts
});

test('react fires the action and logs an episode using the provided note', async (t) => {
  const ctx = testContext();
  const calls: string[] = [];
  mockBus(t, (command) => {
    calls.push(command);
    return { ok: true };
  });

  const result = await react(ctx, 'greet', 'user just opened the app', fastReset);

  assert.deepEqual(calls, ['expression.set', 'animation.play']);
  assert.equal(result.action.ok, true);
  assert.equal(result.episode?.content, 'user just opened the app');
  assert.equal(recallMemories(ctx, 'opened').length, 1);

  await waitFor(() => calls.length >= 3); // let the background reset finish before the mock unmounts
});

test('react logs no episode when no note is given — a bare action name says nothing worth recalling', async (t) => {
  const ctx = testContext();
  const bus = mockBus(t, () => ({ ok: true }));

  const result = await react(ctx, 'think', undefined, fastReset);
  assert.equal(result.action.ok, true);
  assert.equal(result.episode, null);
  assert.equal(recallMemories(ctx, 'think').length, 0);

  await waitFor(() => bus.commandCalls >= 3); // let the background reset finish before the mock unmounts
});

test('react does not log an episode when the underlying action fails', async (t) => {
  const ctx = testContext();
  mockBus(t, () => ({ ok: false, error: 'bad-payload' }));

  const result = await react(ctx, 'greet', 'should not be remembered', fastReset);

  assert.equal(result.action.ok, false);
  assert.equal(result.episode, null);
  assert.equal(recallMemories(ctx, 'remembered').length, 0);
});

test('speak synthesizes then sends audio.play with a path, not the bytes', async (t) => {
  const ctx = testContext();
  const calls: Array<{ url: string; command?: string; payload?: unknown }> = [];

  t.mock.method(globalThis, 'fetch', async (url: unknown, init?: RequestInit) => {
    const href = String(url);
    if (href.endsWith('/v1/command')) {
      const body = JSON.parse(init?.body as string);
      calls.push({ url: href, command: body.command, payload: body.payload });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    calls.push({ url: href });
    if (href.includes('/audio_query')) {
      return new Response(JSON.stringify({ mock: 'query' }), { status: 200 });
    }
    return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
  });

  await speak(ctx, 'こんにちは');

  const busCall = calls.find((call) => call.command === 'audio.play');
  assert.ok(busCall, 'expected an audio.play bus command');
  assert.equal(typeof (busCall!.payload as { path?: unknown }).path, 'string');
  assert.ok(calls.some((call) => call.url.includes('/audio_query')));
  assert.ok(calls.some((call) => call.url.includes('/synthesis')));
});

test('speak threads emotion/intensity through to the VOICEVOX synthesis query', async (t) => {
  const ctx = testContext();
  let synthesisBody: any;

  t.mock.method(globalThis, 'fetch', async (url: unknown, init?: RequestInit) => {
    const href = String(url);
    if (href.endsWith('/v1/command')) return new Response(JSON.stringify({ ok: true }), { status: 200 });
    if (href.includes('/audio_query')) {
      return new Response(JSON.stringify({ speedScale: 1, pitchScale: 0, intonationScale: 1, volumeScale: 1 }), {
        status: 200,
      });
    }
    synthesisBody = JSON.parse(init?.body as string);
    return new Response(new Uint8Array([1]), { status: 200 });
  });

  await speak(ctx, 'こんにちは', undefined, { emotion: 'sad', intensity: 0.5 });

  // The lerp starts from the always-on baseline (1.06 / 1.15), not from
  // VOICEVOX's raw default — see voice/src/prosody.ts's applyBaseline. A
  // partial intensity therefore lands between the baseline and the target.
  const close = (actual: number, expected: number, label: string) =>
    assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: expected ~${expected}, got ${actual}`);

  close(synthesisBody.speedScale, 0.98, 'speedScale'); // lerp(1.06, 0.9, 0.5)
  close(synthesisBody.intonationScale, 0.965, 'intonationScale'); // lerp(1.15, 0.78, 0.5)
});

test('speak throws when the avatar rejects audio.play', async (t) => {
  const ctx = testContext();
  t.mock.method(globalThis, 'fetch', async (url: unknown) => {
    const href = String(url);
    if (href.endsWith('/v1/command')) {
      return new Response(JSON.stringify({ ok: false, error: 'not-ready' }), { status: 503 });
    }
    if (href.includes('/audio_query')) return new Response(JSON.stringify({}), { status: 200 });
    return new Response(new Uint8Array([1]), { status: 200 });
  });

  await assert.rejects(() => speak(ctx, 'hello'), /not-ready/);
});

test('react with speechText derives emotion/intensity for voice, but skips the facial expression', async (t) => {
  const ctx = testContext();
  let synthesisBody: any;
  const commands: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: unknown, init?: RequestInit) => {
    const href = String(url);
    if (href.endsWith('/v1/command')) {
      commands.push(JSON.parse(init?.body as string).command);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    if (href.includes('/v1/state')) {
      return new Response(JSON.stringify({ ok: true, current: { overlay: null } }), { status: 200 });
    }
    if (href.includes('/audio_query')) {
      return new Response(JSON.stringify({ speedScale: 1, pitchScale: 0, intonationScale: 1, volumeScale: 1 }), {
        status: 200,
      });
    }
    synthesisBody = JSON.parse(init?.body as string);
    return new Response(new Uint8Array([1]), { status: 200 });
  });

  // shy_flustered = { expressionId: 'surprised', weight: 0.8, voiceEmotion: 'shy' }
  // in bridge/src/actions.ts. The face borrows `surprised` because VRM has no
  // shy preset, but the *voice* has its own shy shape — borrowing surprised's
  // made her sound startled rather than flustered, so the spoken mood is now
  // derived separately from the face one.
  const result = await react(ctx, 'shy_flustered', undefined, fastReset, { text: 'ちょっと待って' });

  assert.equal(result.speech?.spoke, 'ちょっと待って');
  assert.equal(result.speech?.emotion, 'shy'); // the voice mood, not the face preset
  // lerp(baseline 1.06, shy target 1.0, weight 0.8) — from the baseline, not
  // from VOICEVOX's default, so the mood stacks on top of her normal lift.
  assert.ok(
    Math.abs(synthesisBody.speedScale - 1.012) < 1e-9,
    `speedScale: expected ~1.012, got ${synthesisBody.speedScale}`,
  );
  assert.equal(result.action.autoReset, false); // nothing to auto-clear when expression was never set

  // A held facial expression fighting lip-sync visemes read as an uncanny,
  // static face (confirmed live by the user) — animation.play + speech's own
  // audio.play still happen, but expression.set never does.
  assert.deepEqual(commands, ['animation.play', 'audio.play']);
});

test('react with speechText still speaks, with no emotion attached, when the action id is unknown', async (t) => {
  const ctx = testContext();
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: unknown) => {
    const href = String(url);
    calls.push(href);
    if (href.includes('/audio_query')) return new Response(JSON.stringify({ speedScale: 1 }), { status: 200 });
    if (href.includes('/synthesis')) return new Response(new Uint8Array([1]), { status: 200 });
    // The unknown action never reaches a bus call at all (runAction bails out
    // before any fetch), so this only exists to satisfy audio.play from speak().
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });

  const result = await react(ctx, 'not_a_real_action', undefined, fastReset, { text: 'hmm' });

  assert.equal(result.action.ok, false);
  assert.equal(result.speech?.spoke, 'hmm');
  assert.equal(result.speech?.emotion, undefined);
  assert.ok(calls.some((url) => url.includes('/audio_query')), 'still spoke despite the unknown action');
});

test('react starts voice synthesis alongside the gesture, not after it resolves', async (t) => {
  const ctx = testContext();
  const order: string[] = [];
  let releaseAnimation = () => {};
  const animationGate = new Promise<void>((resolve) => {
    releaseAnimation = resolve;
  });

  t.mock.method(globalThis, 'fetch', async (url: unknown, init?: RequestInit) => {
    const href = String(url);
    if (href.endsWith('/v1/command')) {
      const body = JSON.parse(init?.body as string);
      // expression.set is skipped entirely when speechText is passed (see the
      // test above) — animation.play is the only runAction bus call left to
      // gate on here.
      if (body.command === 'animation.play') {
        order.push('animation.play:start');
        await animationGate;
        order.push('animation.play:resolve');
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    if (href.includes('/v1/state')) {
      return new Response(JSON.stringify({ ok: true, current: { overlay: null } }), { status: 200 });
    }
    if (href.includes('/audio_query')) {
      order.push('audio_query');
      return new Response(JSON.stringify({ speedScale: 1 }), { status: 200 });
    }
    order.push('synthesis');
    return new Response(new Uint8Array([1]), { status: 200 });
  });

  const pending = react(ctx, 'think', undefined, fastReset, { text: 'considering this' });

  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(order.includes('audio_query'), 'voice synthesis should start while the gesture bus call is still pending');
  assert.ok(!order.includes('animation.play:resolve'), 'the gesture call should still be gated at this point');

  releaseAnimation();
  await pending;
});

test('react rejects an unknown action without touching memory', async (t) => {
  const ctx = testContext();
  mockBus(t, () => ({ ok: true }));

  const result = await react(ctx, 'not_a_real_action');

  assert.equal(result.action.ok, false);
  assert.equal(result.action.step, 'unknown-action');
  assert.equal(result.episode, null);
});

test('look captures through vision and returns the saved path', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'avelyn-engine-look-'));
  try {
    const ctx = { ...testContext(), vision: { dir, settingsPath: join(dir, 'settings.json') } };
    const result = await look(ctx, {
      foreground: async () => ({ process: 'Code', title: 'Avelyn' }),
      grab: async (path) => writeFile(path, 'png'),
    });
    assert.equal(result.ok, true);
    assert.equal((await readdir(dir)).filter((name) => name.endsWith('.png')).length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('look honours the vision settings in the app runtime file (switched off means no capture)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'avelyn-engine-look-'));
  try {
    const settingsPath = join(dir, 'runtime.json');
    await writeFile(settingsPath, JSON.stringify({ vision: { enabled: false } }));
    const ctx = { ...testContext(), vision: { dir, settingsPath } };
    const result = await look(ctx, {
      foreground: async () => ({ process: 'Code', title: 'Avelyn' }),
      grab: async (path) => writeFile(path, 'png'),
    });
    assert.equal(result.ok, false);
    assert.equal((await readdir(dir)).filter((name) => name.endsWith('.png')).length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('look with a missing settings file still works, on the defaults', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'avelyn-engine-look-'));
  try {
    const ctx = { ...testContext(), vision: { dir, settingsPath: join(dir, 'nope.json') } };
    const result = await look(ctx, {
      foreground: async () => ({ process: 'Code', title: 'Avelyn' }),
      grab: async (path) => writeFile(path, 'png'),
    });
    assert.equal(result.ok, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// Seen live 2026-10-21 on Claude: she called speak twice in one turn with the
// identical line, and the user heard it twice.
test('the same line spoken again within a few seconds plays once', async (t) => {
  const ctx = testContext();
  let plays = 0;
  t.mock.method(globalThis, 'fetch', async (url: unknown, init?: RequestInit) => {
    const href = String(url);
    if (href.endsWith('/v1/command')) {
      if (JSON.parse(init?.body as string).command === 'audio.play') plays += 1;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    if (href.includes('/audio_query')) return new Response(JSON.stringify({ mock: 'query' }), { status: 200 });
    return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
  });

  let now = 1_000_000;
  const clock = () => now;
  await speak(ctx, 'そっか、ゆっくりやって。', undefined, undefined, clock);
  now += 2_000;
  await speak(ctx, 'そっか、ゆっくりやって。', undefined, undefined, clock);
  assert.equal(plays, 1, 'the repeat is skipped');

  await speak(ctx, '別のこと。', undefined, undefined, clock);
  assert.equal(plays, 2, 'a different line still plays');

  now += 60_000;
  await speak(ctx, 'そっか、ゆっくりやって。', undefined, undefined, clock);
  assert.equal(plays, 3, 'the same line later on is a new utterance');
});
