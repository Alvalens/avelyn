import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Session, type SpawnFn } from '../session.ts';
import { REPO_ROOT, type BrainConfig } from '../config.ts';
import { agyDialect } from './agy.ts';
import { claudeArgs, claudeDialect, type EngineLaunch } from './claude.ts';
import { CodexSession } from './codex.ts';
import type { Brain, Provider } from './types.ts';

export type { Brain, Provider } from './types.ts';

const EXECUTABLE: Record<Provider, string> = { agy: 'agy', claude: 'claude', codex: 'codex' };

/** Where each CLI's own installer puts it, for when it is not on PATH. */
function installedAt(provider: Provider, env: NodeJS.ProcessEnv): string {
  const local = env.LOCALAPPDATA ?? 'C:\\Users\\Default\\AppData\\Local';
  const home = env.USERPROFILE ?? 'C:\\Users\\Default';
  switch (provider) {
    case 'agy': return join(local, 'agy', 'bin', 'agy.exe');
    case 'claude': return join(home, '.local', 'bin', 'claude.exe');
    case 'codex': return join(local, 'Programs', 'OpenAI', 'Codex', 'bin', 'codex.exe');
  }
}

/**
 * The CLI's executable as a full path. It has to be the real `.exe`: Node's
 * spawn does not apply PATHEXT without a shell, so a bare 'claude' never
 * resolves to 'claude.exe' and fails with an ENOENT that looks like a missing
 * install. Passing shell:true would paper over it, but the shell becomes the
 * child we hold — killing it would leave the CLI running.
 *
 * An npm-installed CLI is a `.cmd` shim, which cannot be spawned without a
 * shell; point AVELYN_BRAIN_BINARY at a real executable instead.
 */
export function resolveBinary(
  provider: Provider,
  explicit: string,
  env: NodeJS.ProcessEnv = process.env,
  exists: (path: string) => boolean = existsSync,
): string {
  if (explicit) return explicit;
  const name = `${EXECUTABLE[provider]}.exe`;
  for (const dir of (env.PATH ?? env.Path ?? '').split(';').filter(Boolean)) {
    const candidate = join(dir, name);
    if (exists(candidate)) return candidate;
  }
  return installedAt(provider, env);
}

/** Tried in this order when the chosen CLI is not installed. */
const FALLBACK_ORDER: Provider[] = ['claude', 'codex', 'agy'];

/**
 * The brain to actually run. If the chosen CLI is not installed, the first one
 * that is — with no model, since the chosen model belonged to the other CLI.
 * Without this, a user with only Claude Code or Codex got a restart loop: the
 * default brain is agy, spawning it failed, the pipeline exited, the app
 * restarted it. A binary set by hand, or nothing installed at all, keeps the
 * choice (the spawn error then names what is missing).
 */
export function resolveProvider(
  config: BrainConfig,
  env: NodeJS.ProcessEnv = process.env,
  exists: (path: string) => boolean = existsSync,
): BrainConfig {
  if (config.binary) return config;
  const installed = (provider: Provider) => exists(resolveBinary(provider, '', env, exists));
  if (installed(config.provider)) return config;
  const fallback = FALLBACK_ORDER.find(installed);
  return fallback ? { ...config, provider: fallback, model: '', resume: '' } : config;
}

/** How a brain that takes MCP servers per launch should start the engine. */
export function engineLaunch(repoRoot: string, nodePath: string = process.execPath): EngineLaunch {
  return { command: nodePath, args: ['--no-warnings', join(repoRoot, 'engine', 'src', 'server.ts')] };
}

/**
 * agy's own default model, from its settings — agy never says which model a
 * session runs on, so "CLI default" is read where agy reads it. Null when the
 * file cannot be read: better no label than a wrong one.
 */
export function agyDefaultModel(read: () => string): string | null {
  try {
    const model = (JSON.parse(read()) as { model?: unknown }).model;
    return typeof model === 'string' && model.trim() ? model.trim() : null;
  } catch {
    return null;
  }
}

function agySettingsPath(env: NodeJS.ProcessEnv): string {
  return join(env.USERPROFILE ?? env.HOME ?? '', '.gemini', 'antigravity-cli', 'settings.json');
}

export interface BrainDeps {
  /** Her working dir — her home outside the repo (ears/src/home.ts), where her persona is. */
  cwd: string;
  /** Where the engine lives. Never her cwd: that is outside the repo. */
  repoRoot?: string;
  /** Folders outside her home she must be able to read. */
  readDirs?: string[];
  env?: NodeJS.ProcessEnv;
  exists?: (path: string) => boolean;
  nodePath?: string;
  spawn?: SpawnFn;
  /** Reads agy's settings.json; injected in tests. */
  readAgySettings?: () => string;
}

export function createBrain(config: BrainConfig, deps: BrainDeps): Brain {
  const command = resolveBinary(config.provider, config.binary, deps.env, deps.exists);
  const model = config.model || undefined;
  const resume = config.resume || undefined;
  const engine = engineLaunch(deps.repoRoot ?? REPO_ROOT, deps.nodePath);
  const readDirs = deps.readDirs ?? [];

  switch (config.provider) {
    case 'agy': {
      const env = deps.env ?? process.env;
      const read = deps.readAgySettings ?? (() => readFileSync(agySettingsPath(env), 'utf8'));
      return new Session({
        command, cwd: deps.cwd, spawn: deps.spawn,
        model: model ?? agyDefaultModel(read),
        args: agyDialect.args({ model, resume, readDirs }),
        dialect: agyDialect(),
      });
    }
    case 'claude':
      return new Session({
        command, cwd: deps.cwd, spawn: deps.spawn,
        args: claudeArgs({ engine, model, resume, readDirs }),
        dialect: claudeDialect(),
        model: model ?? null,
      });
    case 'codex':
      return new CodexSession({ command, cwd: deps.cwd, engine, model, resume, spawn: deps.spawn });
  }
}
