import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodeWav } from './wav.ts';
import { correctTranscript, looksLikeSilence, parseTranscript } from './transcript.ts';

export interface WhisperRunResult {
  stdout: string;
  stderr: string;
  code: number;
}

export type WhisperRunner = (args: string[]) => Promise<WhisperRunResult>;

export interface TranscribeOptions {
  binaryPath: string;
  modelPath: string;
  /**
   * Initial prompt biasing the decoder's vocabulary. Use with care: whisper
   * treats prompt text as already said, so "Avelyn" here made it skip a
   * spoken "Hi Avelyn." — her name is corrected afterwards instead.
   */
  prompt?: string;
  sampleRate?: number;
  /**
   * The recording's raw peak (0..1), measured before any gain was applied.
   * Lets "Thank you." over real speech count as speech — see looksLikeSilence.
   */
  inputPeak?: number;
  /**
   * Also write the encoded audio here, byte-identical to what whisper gets.
   *
   * The recording is otherwise deleted milliseconds after use, leaving no way
   * to hear what recognition was actually working from — which is exactly the
   * question when the transcript looks wrong. Being able to play it back
   * separates a bad microphone from bad recognition.
   */
  keepPath?: string;
  /** Injected in tests; defaults to really spawning whisper-cli. */
  run?: WhisperRunner;
}

export interface TranscribeResult {
  text: string;
  /** True when the audio held no speech — see looksLikeSilence. */
  silent: boolean;
}

const spawnRunner: WhisperRunner = (args) =>
  new Promise((resolve) => {
    const [command, ...rest] = args;
    const child = spawn(command, rest, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    // A spawn that never starts (missing binary, bad model path) reports
    // through 'error', not 'close' — resolved as a failure so it surfaces as
    // a thrown error rather than as a silently empty transcript.
    child.on('error', (error) => resolve({ stdout, stderr: stderr + error.message, code: -1 }));
    child.on('close', (code) => resolve({ stdout, stderr, code: code ?? -1 }));
  });

export async function transcribe(
  pcm: Int16Array,
  options: TranscribeOptions,
): Promise<TranscribeResult> {
  const dir = await mkdtemp(join(tmpdir(), 'avelyn-ears-'));
  const wavPath = join(dir, 'speech.wav');

  try {
    // Encoded once and written twice: re-encoding for the kept copy could
    // produce different bytes, which would defeat the point of keeping it.
    const wav = encodeWav(pcm, options.sampleRate ?? 16000);
    await writeFile(wavPath, wav);
    if (options.keepPath) await writeFile(options.keepPath, wav);

    const args = [
      options.binaryPath,
      '-m', options.modelPath,
      '-f', wavPath,
      '-l', 'en',
      '-nt', // timestamps would only have to be parsed back off again
    ];
    if (options.prompt) args.push('--prompt', options.prompt);

    const result = await (options.run ?? spawnRunner)(args);

    if (result.code !== 0) {
      // Deliberately an error, not an empty transcript: "you said nothing"
      // and "whisper is broken" must not look the same to the caller.
      throw new Error(
        `whisper-cli exited ${result.code}: ${result.stderr.trim() || '(no stderr)'}`,
      );
    }

    const text = correctTranscript(parseTranscript(result.stdout));
    return { text, silent: looksLikeSilence(text, options.inputPeak) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
