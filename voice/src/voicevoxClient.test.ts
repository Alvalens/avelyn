import { test } from 'node:test';
import assert from 'node:assert/strict';
import { audioQuery, synthesize, speak, listSpeakers } from './voicevoxClient.ts';

const config = { baseUrl: 'http://x', speakerId: 3 };

test('audioQuery posts text and speaker as query params', async (t) => {
  let capturedUrl: unknown;
  t.mock.method(globalThis, 'fetch', async (url: unknown) => {
    capturedUrl = url;
    return new Response(JSON.stringify({ accentPhrases: [] }), { status: 200 });
  });

  const query = await audioQuery(config, 'hello', 3);

  assert.equal(capturedUrl, 'http://x/audio_query?text=hello&speaker=3');
  assert.deepEqual(query, { accentPhrases: [] });
});

test('synthesize posts the query JSON and returns a Buffer of the response body', async (t) => {
  let capturedInit: RequestInit | undefined;
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => {
    capturedInit = init;
    return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
  });

  const wav = await synthesize(config, { speedScale: 1 }, 3);

  assert.deepEqual(JSON.parse(capturedInit?.body as string), { speedScale: 1 });
  assert.ok(Buffer.isBuffer(wav));
  assert.deepEqual([...wav], [1, 2, 3]);
});

test('speak chains audioQuery then synthesize', async (t) => {
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: unknown) => {
    const path = new URL(url as string).pathname;
    calls.push(path);
    if (path === '/audio_query') return new Response(JSON.stringify({ ok: true }), { status: 200 });
    return new Response(new Uint8Array([9]), { status: 200 });
  });

  const wav = await speak(config, 'hello');

  assert.deepEqual(calls, ['/audio_query', '/synthesis']);
  assert.deepEqual([...wav], [9]);
});

test('speak lifts a line with no emotion — plain talk is not left at VOICEVOX defaults', async (t) => {
  // Regression test for the flat read the user heard. Plain-talk turns go
  // through `speak` with no emotion (persona/AGENTS.md actively invites omitting it),
  // which used to skip applyEmotion entirely — so speed/pitch/intonation all
  // sat at VOICEVOX's raw defaults and every ordinary line came out flat.
  let sentQuery: any;
  t.mock.method(globalThis, 'fetch', async (url: unknown, init?: RequestInit) => {
    const path = new URL(url as string).pathname;
    if (path === '/audio_query') {
      return new Response(
        JSON.stringify({ speedScale: 1, pitchScale: 0, intonationScale: 1, volumeScale: 1, pauseLengthScale: 1 }),
        { status: 200 },
      );
    }
    sentQuery = JSON.parse(init?.body as string);
    return new Response(new Uint8Array([1]), { status: 200 });
  });

  await speak(config, 'hello');

  assert.equal(sentQuery.prePhonemeLength, 0.05);
  assert.ok(sentQuery.intonationScale > 1, `intonation should be lifted off default, got ${sentQuery.intonationScale}`);
  assert.ok(sentQuery.speedScale > 1, `speed should be nudged up, got ${sentQuery.speedScale}`);
  assert.ok(sentQuery.pauseLengthScale < 1, `pauses should tighten, got ${sentQuery.pauseLengthScale}`);
});

test('speak applies emotion scaling to the query sent for synthesis', async (t) => {
  let sentQuery: any;
  t.mock.method(globalThis, 'fetch', async (url: unknown, init?: RequestInit) => {
    const path = new URL(url as string).pathname;
    if (path === '/audio_query') {
      return new Response(JSON.stringify({ speedScale: 1, pitchScale: 0, intonationScale: 1, volumeScale: 1 }), {
        status: 200,
      });
    }
    sentQuery = JSON.parse(init?.body as string);
    return new Response(new Uint8Array([1]), { status: 200 });
  });

  await speak(config, 'hello', undefined, { emotion: 'happy' });

  // Tolerance, not equality: the emotion now lerps from the baseline rather
  // than from VOICEVOX's default, so full intensity lands on the target plus
  // float noise instead of on the exact literal.
  const close = (actual: number, expected: number, label: string) =>
    assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: expected ~${expected}, got ${actual}`);

  close(sentQuery.speedScale, 1.08, 'speedScale');
  close(sentQuery.pitchScale, 0.05, 'pitchScale');
  close(sentQuery.intonationScale, 1.35, 'intonationScale');
  close(sentQuery.pauseLengthScale, 0.88, 'pauseLengthScale');
  assert.equal(sentQuery.prePhonemeLength, 0.05); // both apply together, not one replacing the other
});

test('a non-ok response throws with the engine action and status in the message', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('boom', { status: 500 }));

  await assert.rejects(() => audioQuery(config, 'hello'), /audioQuery failed: HTTP 500/);
});

test('listSpeakers maps snake_case fields to camelCase', async (t) => {
  t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(
        JSON.stringify([
          { name: 'Zundamon', speaker_uuid: 'abc', styles: [{ name: 'Normal', id: 3 }] },
        ]),
        { status: 200 },
      ),
  );

  const speakers = await listSpeakers(config);

  assert.deepEqual(speakers, [{ name: 'Zundamon', speakerUuid: 'abc', styles: [{ name: 'Normal', id: 3 }] }]);
});

test('speak sends every line out louder than VOICEVOX default, with and without a mood', async (t) => {
  const sent: Record<string, unknown>[] = [];
  t.mock.method(globalThis, 'fetch', async (url: unknown, init?: RequestInit) => {
    const path = new URL(url as string).pathname;
    if (path === '/audio_query') return new Response(JSON.stringify({ volumeScale: 1 }), { status: 200 });
    sent.push(JSON.parse(init?.body as string));
    return new Response(new Uint8Array([9]), { status: 200 });
  });

  await speak(config, 'plain');
  await speak(config, 'quiet one', 3, { emotion: 'sad' });

  const [plain, sad] = sent.map((query) => query.volumeScale as number);
  assert.ok(plain > 1.2, `plain line should be lifted, got ${plain}`);
  assert.ok(sad < plain, 'a sad line is still quieter than a plain one');
  assert.ok(sad > 0.88, 'but louder than the old sad');
});
