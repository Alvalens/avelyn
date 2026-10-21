import type { Dialect, DialectEvent } from '../session.ts';
import { isVoiceCall, spokenLine } from './types.ts';

export interface AgyArgsOptions {
  model?: string;
  /** A conversation id to pick up again, after a crash. */
  resume?: string;
  /** Folders outside her home she must read (the screenshots `look` takes). */
  readDirs?: string[];
}

/**
 * Antigravity's NDJSON: `{event:'user'}` lines in; `init`, `step_update` and
 * `result` events out.
 */
export function agyDialect(): Dialect {
  return {
    encode: (text) => JSON.stringify({ event: 'user', message: { role: 'user', content: text } }),
    decode: (raw) => {
      const event = raw as {
        event?: string;
        conversation_id?: string;
        result?: { status?: string; response?: string; error?: string };
        step_update?: {
          step_index?: number;
          step_type?: string;
          text_delta?: string;
          tool_info?: { parameters?: { ServerName?: string; ToolName?: string; Arguments?: unknown } };
        };
      };
      const out: DialectEvent[] = [];

      if (event.event === 'init' && typeof event.conversation_id === 'string') {
        out.push({ kind: 'session', id: event.conversation_id });
      }

      // `agent_response` steps carry a `text_delta` each (the closing DONE
      // update included). Other step types are her working, not talking.
      const step = event.step_update;
      if (event.event === 'step_update' && step?.step_type === 'agent_response'
        && typeof step.text_delta === 'string') {
        out.push({ kind: 'text', step: String(step.step_index ?? -1), delta: step.text_delta });
      }

      // An MCP call is a 'tool' step; its server and tool are in tool_info.
      const call = step?.tool_info?.parameters;
      if (event.event === 'step_update' && step?.step_type === 'tool' && isVoiceCall(call?.ServerName, call?.ToolName)) {
        out.push({ kind: 'voice', spoken: spokenLine(call?.ToolName, call?.Arguments) });
      }

      if (event.event === 'result' && event.result) {
        const { status, response, error } = event.result;
        out.push(status === 'SUCCESS'
          ? { kind: 'done', ok: true, reply: response ?? '' }
          : { kind: 'done', ok: false, error: error || `agy turn failed (status ${status ?? 'unknown'})` });
      }
      return out;
    },
  };
}

/**
 * Args that put `agy` into the mode this whole design depends on: NDJSON in,
 * NDJSON out, one turn per line written to stdin. `--print` has to be given a
 * value or it swallows the following flag as its prompt — an empty one, since
 * with stream input there is no prompt to pass.
 *
 * `--new-project` is not optional. Without it a headless session
 * intermittently skips AGENTS.md and answers as a generic assistant.
 *
 * The engine's MCP server is not passed here: agy has no per-launch flag for
 * it, so it is registered once with `agy mcp add` (see engine/README.md).
 */
agyDialect.args = function args(options: AgyArgsOptions = {}): string[] {
  return [
    '--dangerously-skip-permissions',
    '--new-project',
    ...(options.model ? ['--model', options.model] : []),
    ...(options.resume ? ['--conversation', options.resume] : []),
    ...(options.readDirs ?? []).flatMap((dir) => ['--add-dir', dir]),
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--print=',
  ];
};
