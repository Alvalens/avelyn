import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Her own working folder, outside the repo: %LOCALAPPDATA%\avelyn\home.
 *
 * Outside on purpose. Every agent CLI auto-loads the AGENTS.md (and
 * CLAUDE.md) of its working folder and the folders above it, so a session
 * run from the repo would read the repo's own AGENTS.md — the setup guide for
 * coding agents — and, the other way round, anyone opening an agent in the
 * repo would get her persona. Her persona lives at persona/AGENTS.md and is
 * copied in here on every start.
 *
 * AVELYN_HOME overrides it.
 */
export function homePath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.AVELYN_HOME?.trim()) return env.AVELYN_HOME;
  const local = env.LOCALAPPDATA ?? join(env.USERPROFILE ?? env.HOME ?? '', 'AppData', 'Local');
  return join(local, 'avelyn', 'home');
}

/** Copy persona/AGENTS.md into her home (refreshed every start, so edits land). Returns the home. */
export function preparePersona(home: string, repoRoot: string): string {
  mkdirSync(home, { recursive: true });
  copyFileSync(join(repoRoot, 'persona', 'AGENTS.md'), join(home, 'AGENTS.md'));
  return home;
}
