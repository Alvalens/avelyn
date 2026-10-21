import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { transcribe } from './transcribe.ts';

const OPTS = { binaryPath: 'whisper-cli', modelPath: 'C:\\models\\ggml-base.en.bin', prompt: 'Avelyn' };

/** Records the args it was called with, and can assert the wav existed then. */
function fakeRunner(stdout: string, code = 0) {
  const calls: { args: string[]; wavExisted: boolean }[] = [];
  return {
    calls,
    run: async (args: string[]) => {
      const fileFlag = args.indexOf('-f');
      const wavPath = fileFlag >= 0 ? args[fileFlag + 1] : '';
      calls.push({ args, wavExisted: existsSync(wavPath) });
      return { stdout, stderr: '', code };
    },
  };
}

const SPEECH = '\n Hey Avelyn, what are you working on right now?\n';
const SILENCE = '\n You\n';

test('passes the model, the audio file, English and the name bias to whisper', async () => {
  const runner = fakeRunner(SPEECH);

  await transcribe(new Int16Array([1, 2, 3]), { ...OPTS, run: runner.run });

  const { args } = runner.calls[0];
  assert.equal(args[0], OPTS.binaryPath);
  assert.equal(args[args.indexOf('-m') + 1], OPTS.modelPath);
  assert.equal(args[args.indexOf('-l') + 1], 'en');
  assert.equal(args[args.indexOf('--prompt') + 1], 'Avelyn');
  assert.ok(args.includes('-nt'), 'timestamps off — they are noise to parse around');
});

test('the audio file still exists when whisper is invoked', async () => {
  const runner = fakeRunner(SPEECH);

  await transcribe(new Int16Array([1, 2, 3]), { ...OPTS, run: runner.run });

  assert.equal(runner.calls[0].wavExisted, true);
});

test('returns the transcript and marks it not silent', async () => {
  const runner = fakeRunner(SPEECH);

  const result = await transcribe(new Int16Array([1, 2, 3]), { ...OPTS, run: runner.run });

  assert.equal(result.text, 'Hey Avelyn, what are you working on right now?');
  assert.equal(result.silent, false);
});

test('her name comes back corrected', async () => {
  const runner = fakeRunner('\n Hi Evelyn. Can you hear me?\n');

  const result = await transcribe(new Int16Array([1, 2, 3]), { ...OPTS, run: runner.run });

  assert.equal(result.text, 'Hi Avelyn. Can you hear me?');
});

test('"thank you" over a recording with real signal is speech, not silence', async () => {
  const runner = fakeRunner('\n Thank you.\n');

  const result = await transcribe(new Int16Array([1, 2, 3]), { ...OPTS, inputPeak: 0.3, run: runner.run });

  assert.equal(result.silent, false);
});

test('a whisper silence hallucination comes back marked silent', async () => {
  const runner = fakeRunner(SILENCE);

  const result = await transcribe(new Int16Array([0, 0, 0]), { ...OPTS, run: runner.run });

  assert.equal(result.silent, true);
});

test('omits the prompt flag entirely when there is no prompt', async () => {
  const runner = fakeRunner(SPEECH);

  await transcribe(new Int16Array([1]), { ...OPTS, prompt: undefined, run: runner.run });

  assert.equal(runner.calls[0].args.includes('--prompt'), false);
});

test('a non-zero exit surfaces stderr rather than pretending to be empty audio', async () => {
  const run = async () => ({ stdout: '', stderr: 'failed to load model', code: 1 });

  await assert.rejects(
    () => transcribe(new Int16Array([1]), { ...OPTS, run }),
    /failed to load model/,
  );
});

test('a failed run is not mistaken for silence', async () => {
  const run = async () => ({ stdout: '', stderr: 'boom', code: 1 });

  // Silence is a legitimate outcome that means "you said nothing"; a crash is
  // a broken install. Collapsing them would hide a missing model forever.
  await assert.rejects(() => transcribe(new Int16Array([1]), { ...OPTS, run }));
});

// The recording is otherwise deleted within milliseconds of being used, so
// there is no way to hear what recognition was actually given - which is the
// difference between a bad microphone and bad recognition.
test('copies the exact audio handed to whisper when asked to keep it', async () => {
  const { readFileSync, rmSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');

  const keepPath = join(tmpdir(), `avelyn-keep-${Date.now()}.wav`);
  // Read inside the runner: the temp file is deleted the moment transcribe
  // returns, so it cannot be inspected afterwards.
  let sentToWhisper: Buffer | null = null;
  const run = async (args: string[]) => {
    sentToWhisper = readFileSync(args[args.indexOf('-f') + 1]);
    return { stdout: SPEECH, stderr: '', code: 0 };
  };

  await transcribe(new Int16Array([100, -100, 200]), { ...OPTS, keepPath, run });
  try {
    assert.ok(sentToWhisper, 'whisper was invoked');
    assert.equal(readFileSync(keepPath).equals(sentToWhisper), true,
      'the kept file must be byte-identical to what whisper received');
  } finally {
    rmSync(keepPath, { force: true });
  }
});

test('the temp audio file is cleaned up after a successful run', async () => {
  const runner = fakeRunner(SPEECH);
  let wavPath = '';

  await transcribe(new Int16Array([1, 2, 3]), { ...OPTS, run: async (args) => {
    wavPath = args[args.indexOf('-f') + 1];
    return runner.run(args);
  } });

  assert.ok(wavPath, 'a wav path was passed');
  assert.equal(existsSync(wavPath), false, 'temp wav removed');
});

test('the temp audio file is cleaned up even when whisper fails', async () => {
  let wavPath = '';
  const run = async (args: string[]) => {
    wavPath = args[args.indexOf('-f') + 1];
    return { stdout: '', stderr: 'boom', code: 1 };
  };

  await assert.rejects(() => transcribe(new Int16Array([1]), { ...OPTS, run }));
  assert.equal(existsSync(wavPath), false, 'temp wav removed on failure too');
});
