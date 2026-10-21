import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * What the avatar app tells the Node 24 side (the engine, the pipeline):
 * written by avatar/avatar/electron/runtime-file.cjs whenever its settings or
 * its agent bus change. It is how a fresh clone runs without any .env file.
 *
 * Holds the bus token in plain text — the same exposure the old engine/.env
 * had, in the user's own profile.
 */
export interface Runtime {
  /** null while the bus is off. */
  bus?: { url?: string; token?: string | null } | null;
  /** The `vision` section of config.yaml — see vision/src/settings.ts. */
  vision?: unknown;
}

/** Beside whisper, in the per-user avelyn folder. AVELYN_RUNTIME overrides it. */
export function runtimePath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.AVELYN_RUNTIME?.trim()) return env.AVELYN_RUNTIME;
  const local = env.LOCALAPPDATA ?? join(env.USERPROFILE ?? env.HOME ?? '', 'AppData', 'Local');
  return join(local, 'avelyn', 'runtime.json');
}

/** Never throws: no file (the app has not run yet) is simply nothing known. */
export function readRuntime(path: string = runtimePath()): Runtime {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}
