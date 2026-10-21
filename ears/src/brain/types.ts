export interface AskOptions {
  /**
   * Called with the text of her current reply each time it grows, before the
   * turn is over. A later text step (she wrote something, ran a tool, wrote
   * the answer) replaces the earlier one rather than adding to it, so this is
   * what a subtitle should show right now, not a transcript of the turn.
   */
  onText?: (text: string) => void;
}

/**
 * Her brain: one long-lived agent CLI session, whichever CLI it is. Turns are
 * serialized; the reply is the last text step she wrote, not every step
 * glued together.
 */
export interface Brain {
  ask(text: string, options?: AskOptions): Promise<string>;
  close(): void;
  /** Gone without close() — the pipeline exits so the app starts a fresh one. */
  readonly died: boolean;
  /** The CLI's id for this conversation, once it has said; used to resume after a crash. */
  readonly sessionId: string | null;
  /** The model she is running on, as precisely as the CLI says — null when it cannot be known. */
  readonly model: string | null;
}

/**
 * Her voice call: `speak`, or `react` (which carries speechText). persona/AGENTS.md
 * has her write the English line *first* and then call one of these, so the
 * text step in front of the call is the subtitle. What some CLIs write after
 * it is narration ("I answered out loud too."), not something she said.
 */
export function isVoiceCall(server: string | undefined, tool: string | undefined): boolean {
  return server === 'avelyn-engine' && (tool === 'speak' || tool === 'react');
}

/** The line a voice call speaks: speak's `text`, react's `speechText`. */
export function spokenLine(tool: string | undefined, args: unknown): string | undefined {
  if (!args || typeof args !== 'object') return undefined;
  const value = (args as Record<string, unknown>)[tool === 'react' ? 'speechText' : 'text'];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export type Provider = 'agy' | 'claude' | 'codex';

export const PROVIDERS: Provider[] = ['agy', 'claude', 'codex'];
