import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROVIDERS, type Provider } from './brain/types.ts';
import { homePath } from './home.ts';

export interface BrainConfig {
  provider: Provider;
  /** Empty means the CLI's own default model. */
  model: string;
  /** Full path to the CLI's executable, when set by hand; otherwise it is looked up. */
  binary: string;
  /** A session id to resume — set by the app only when restarting a crashed pipeline. */
  resume: string;
}

export interface EarsConfig {
  brain: BrainConfig;
  whisperBinaryPath: string;
  whisperModelPath: string;
  prompt: string;
  /** Working directory for her session; AGENTS.md is read from here. */
  cwd: string;
  /** cwd is her own home (see home.ts), so the pipeline copies her persona into it. */
  ownHome: boolean;
}

/** The repo root, from this file's own location — ears/src/config.ts. */
export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url)).replace(/[\\/]+$/, '');

function pick(override: string | undefined, fallback: string): string {
  // An unset variable in a .env file commonly arrives as ''. Treating that as
  // a real value yields a config of empty strings that fail later at spawn
  // time, with an error naming nothing useful.
  return override && override.trim() !== '' ? override : fallback;
}

function pickProvider(value: string | undefined): Provider {
  const wanted = value?.trim().toLowerCase();
  return PROVIDERS.find((provider) => provider === wanted) ?? 'agy';
}

export function loadConfigFromEnv(env: NodeJS.ProcessEnv = process.env): EarsConfig {
  const local = env.LOCALAPPDATA ?? 'C:\\Users\\Default\\AppData\\Local';
  const provider = pickProvider(env.AVELYN_BRAIN);

  return {
    brain: {
      provider,
      model: pick(env.AVELYN_BRAIN_MODEL, ''),
      // AGY_BINARY predates the other brains and still works for agy.
      binary: pick(env.AVELYN_BRAIN_BINARY, provider === 'agy' ? pick(env.AGY_BINARY, '') : ''),
      resume: pick(env.AVELYN_RESUME, ''),
    },
    whisperBinaryPath: pick(
      env.WHISPER_BINARY,
      join(local, 'avelyn', 'whisper', 'bin', 'Release', 'whisper-cli.exe'),
    ),
    whisperModelPath: pick(
      env.WHISPER_MODEL,
      join(local, 'avelyn', 'whisper', 'models', 'ggml-base.en.bin'),
    ),
    // Off by default. "Avelyn" here fixed her name but made whisper skip a
    // spoken "Hi Avelyn." entirely — it treats prompt text as already said.
    // Her name is corrected after the fact (transcript.ts) instead.
    prompt: pick(env.WHISPER_PROMPT, ''),
    // Her own home outside the repo (home.ts). A dir set by hand is used as
    // is — nothing is copied into it.
    cwd: pick(env.AVELYN_PROJECT_DIR, homePath(env)),
    ownHome: !(env.AVELYN_PROJECT_DIR && env.AVELYN_PROJECT_DIR.trim() !== ''),
  };
}
