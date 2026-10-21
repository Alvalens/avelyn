import { readRuntime, runtimePath, type Runtime } from './runtime.ts';

export interface CommandResult {
  ok: boolean;
  [key: string]: unknown;
}

export interface AgentBusConfig {
  baseUrl: string;
  token: string;
}

export interface StageState {
  ok: boolean;
  error?: string;
  current?: {
    animationId: string;
    overlay: { animationId: string } | null;
    avatarId: string;
    environment: unknown;
    audioSourceId: string;
  };
  [key: string]: unknown;
}

/**
 * Where the bus is and its token: from the runtime file the avatar app keeps
 * up to date (see runtime.ts), so nothing has to be copied by hand. Env vars
 * win when set — tests and development point them elsewhere.
 */
export function loadConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  runtime: () => Runtime = () => readRuntime(runtimePath(env)),
): AgentBusConfig {
  const envUrl = env.AVATAR_BUS_URL?.trim();
  const envToken = env.AVATAR_BUS_TOKEN?.trim();
  if (envToken) return { baseUrl: envUrl || 'http://127.0.0.1:47903', token: envToken };

  const bus = runtime().bus;
  // A bus run without a token (Settings → Agents) publishes token: null.
  if (bus?.url) return { baseUrl: envUrl || bus.url, token: bus.token ?? '' };

  throw new Error(
    "Can't reach the avatar app: it isn't running, or its agent bus is off (Settings → Agents).",
  );
}

/**
 * For a long-lived process (the engine): resolved on every use rather than
 * once at start, so it works when the app starts after it, and keeps working
 * when the app rotates its token. An unreachable bus fails the one command
 * that needed it, not the whole process.
 */
export function liveBusConfig(load: () => AgentBusConfig = () => loadConfigFromEnv()): AgentBusConfig {
  return {
    get baseUrl() {
      return load().baseUrl;
    },
    get token() {
      return load().token;
    },
  };
}

export async function postCommand(
  config: AgentBusConfig,
  command: string,
  payload: Record<string, unknown> = {},
): Promise<CommandResult> {
  const response = await fetch(`${config.baseUrl}/v1/command`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.token}`,
    },
    body: JSON.stringify({ command, payload }),
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      ok: false,
      error: (body as { error?: string })?.error ?? `HTTP ${response.status}`,
      code: (body as { code?: string })?.code,
    };
  }

  return body as CommandResult;
}

// current.overlay reflects AVATAR's own motionOverlay state — it goes back to
// null the moment a "once" clip's mixer fires 'finished', with no polling
// interval of its own, so this is the real signal, not a guessed duration.
export async function getState(config: AgentBusConfig): Promise<StageState> {
  const response = await fetch(`${config.baseUrl}/v1/state`, {
    headers: { Authorization: `Bearer ${config.token}` },
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    return { ok: false, error: (body as { error?: string })?.error ?? `HTTP ${response.status}` };
  }

  return body as StageState;
}
