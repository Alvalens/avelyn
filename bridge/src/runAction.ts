import { getAction, type PersonalityAction } from './actions.ts';
import { getState, postCommand, type AgentBusConfig, type CommandResult } from './agentBusClient.ts';

export interface RunActionResult {
  ok: boolean;
  actionId: string;
  step?: 'unknown-action' | 'expression' | 'animation';
  error?: string;
  expression?: CommandResult;
  animation?: CommandResult;
  autoReset?: boolean;
  /**
   * The stage has no such clip — a combo without the Pose Library, say. The
   * face still carried the reaction, so this is not a failure.
   */
  animationUnavailable?: boolean;
}

export interface AutoResetOptions {
  /** How often to poll /v1/state while waiting for a one-shot to finish. */
  pollIntervalMs?: number;
  /** Safety cap in case the bus never reports the overlay clearing. */
  pollTimeoutMs?: number;
  /** How long an expression-only action holds before it's cleared — there's no clip to wait on. */
  expressionOnlyHoldMs?: number;
}

export interface RunActionOptions {
  /**
   * Skip expression.set (and its auto-reset) entirely, firing only the
   * gesture/animation. A held facial expression (e.g. "surprised" at full
   * weight) fighting the mouth's own lip-sync visemes for the whole line
   * reads as an uncanny, static face rather than a natural one — confirmed
   * live by the user. The body gesture alone paired with speech reads fine;
   * the face preset does not. `engine/`'s react sets this whenever a
   * speechText is passed alongside the action.
   */
  skipExpression?: boolean;
}

const DEFAULT_RESET_OPTIONS: Required<AutoResetOptions> = {
  pollIntervalMs: 250,
  pollTimeoutMs: 15_000,
  expressionOnlyHoldMs: 4_000,
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForOverlayClear(
  config: AgentBusConfig,
  pollIntervalMs: number,
  pollTimeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + pollTimeoutMs;
  // /v1/state answers from whatever the renderer last *reported* over IPC, not
  // from what was just accepted — reporting the new overlay back to main is a
  // separate, slightly-later round trip (state change -> re-render -> report
  // effect -> IPC) than the animation.play POST this function starts polling
  // right after. The very first poll here routinely lands before that report
  // arrives and reads the *previous* (often null) overlay, which used to read
  // as "already finished" and clear the expression within ~100ms of it being
  // set — a real bug, not a fast animation. Only treat a null overlay as
  // "finished" once this has actually observed it non-null at least once.
  let sawOverlay = false;
  while (Date.now() < deadline) {
    const state = await getState(config);
    if (!state.ok) return;
    if (state.current?.overlay) {
      sawOverlay = true;
    } else if (sawOverlay) {
      return;
    }
    await sleep(pollIntervalMs);
  }
}

async function resetExpression(
  config: AgentBusConfig,
  action: PersonalityAction,
  options: Required<AutoResetOptions>,
  clipPlaying: boolean,
) {
  try {
    if (clipPlaying) {
      await waitForOverlayClear(config, options.pollIntervalMs, options.pollTimeoutMs);
    } else {
      await sleep(options.expressionOnlyHoldMs);
    }
    await postCommand(config, 'expression.set', { id: action.expressionId, weight: 0 });
  } catch (error) {
    console.warn(`[bridge] auto-reset failed for "${action.id}":`, error);
  }
}

export async function runAction(
  config: AgentBusConfig,
  actionId: string,
  resetOptions: AutoResetOptions = {},
  runOptions: RunActionOptions = {},
): Promise<RunActionResult> {
  const action = getAction(actionId);
  if (!action) {
    return { ok: false, actionId, step: 'unknown-action', error: `No personality action "${actionId}".` };
  }

  const { skipExpression = false } = runOptions;

  let expression: CommandResult | undefined;
  if (!skipExpression) {
    expression = await postCommand(config, 'expression.set', {
      id: action.expressionId,
      weight: action.weight ?? 1,
    });
    if (!expression.ok) {
      return {
        ok: false,
        actionId,
        step: 'expression',
        error: String(expression.error ?? 'expression.set failed'),
        expression,
      };
    }
  }

  let animation: CommandResult | undefined;
  let animationUnavailable = false;
  if (action.animationId) {
    // mode: 'once' is what makes this a reaction gesture rather than a
    // permanent selection — omitting it is what left the avatar stuck on the
    // last frame instead of falling back to whatever was playing before.
    animation = await postCommand(config, 'animation.play', { id: action.animationId, mode: 'once' });
    animationUnavailable = !animation.ok && animation.code === 'unknown-animation';
    if (!animation.ok && !animationUnavailable) {
      return {
        ok: false,
        actionId,
        step: 'animation',
        error: String(animation.error ?? 'animation.play failed'),
        expression,
        animation,
      };
    }
  }

  if (!skipExpression) {
    const options = { ...DEFAULT_RESET_OPTIONS, ...resetOptions };
    // No clip playing means nothing to wait on: hold the face like an
    // expression-only action does.
    void resetExpression(config, action, options, Boolean(action.animationId) && !animationUnavailable);
  }

  return {
    ok: true,
    actionId,
    expression,
    animation,
    autoReset: !skipExpression,
    ...(animationUnavailable ? { animationUnavailable } : {}),
  };
}
