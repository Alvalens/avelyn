import type { Dialect, DialectEvent } from '../session.ts';
import { isVoiceCall, spokenLine } from './types.ts';

/** How to start the engine's MCP server: the same for every brain that takes it per launch. */
export interface EngineLaunch {
  command: string;
  args: string[];
}

export interface ClaudeArgsOptions {
  engine: EngineLaunch;
  model?: string;
  /** A session id to pick up again, after a crash. */
  resume?: string;
  /** Folders outside her home she must read (the screenshots `look` takes). */
  readDirs?: string[];
}

/**
 * Claude Code's stream-json: `{type:'user'}` lines in; `system/init`,
 * `stream_event` (raw API events, with --include-partial-messages) and
 * `result` out. Each assistant message opens with `message_start`, so a
 * message counter tells a pre-tool sentence from the answer after the tool.
 */
export function claudeDialect(): Dialect {
  let message = 0;
  return {
    encode: (text) => JSON.stringify({ type: 'user', message: { role: 'user', content: text } }),
    decode: (raw) => {
      const event = raw as {
        type?: string;
        subtype?: string;
        session_id?: string;
        model?: string;
        is_error?: boolean;
        result?: string;
        message?: { content?: { type?: string; name?: string; input?: unknown }[] };
        event?: {
          type?: string;
          index?: number;
          delta?: { type?: string; text?: string };
          content_block?: { type?: string; name?: string };
        };
      };
      const out: DialectEvent[] = [];

      if (event.type === 'system' && event.subtype === 'init' && typeof event.session_id === 'string') {
        out.push({ kind: 'session', id: event.session_id, model: event.model });
      }

      if (event.type === 'stream_event') {
        const inner = event.event;
        if (inner?.type === 'message_start') message += 1;
        // Tool names arrive as mcp__<server>__<tool>, as soon as the call starts.
        const block = inner?.content_block;
        if (inner?.type === 'content_block_start' && block?.type === 'tool_use' && block.name) {
          const [, server, tool] = /^mcp__(.+?)__(.+)$/.exec(block.name) ?? [];
          if (isVoiceCall(server, tool)) out.push({ kind: 'voice' });
        }
        // Only text_delta is her talking; thinking_delta and input_json_delta are not.
        if (inner?.type === 'content_block_delta' && inner.delta?.type === 'text_delta'
          && typeof inner.delta.text === 'string') {
          out.push({ kind: 'text', step: `${message}:${inner.index ?? 0}`, delta: inner.delta.text });
        }
      }

      // The whole tool call, arguments included, once its block is written —
      // still before the tool runs. Carries the line she is about to speak.
      if (event.type === 'assistant') {
        for (const block of event.message?.content ?? []) {
          if (block.type !== 'tool_use' || !block.name) continue;
          const [, server, tool] = /^mcp__(.+?)__(.+)$/.exec(block.name) ?? [];
          if (isVoiceCall(server, tool)) out.push({ kind: 'voice', spoken: spokenLine(tool, block.input) });
        }
      }

      if (event.type === 'result') {
        // An auth failure arrives as subtype "success" with is_error set.
        out.push(event.is_error
          ? { kind: 'done', ok: false, error: event.result || 'claude turn failed' }
          : { kind: 'done', ok: true, reply: event.result ?? '' });
      }
      return out;
    },
  };
}

/**
 * One long-lived `claude -p` taking a turn per stdin line.
 *
 * Isolation matters here more than for the other CLIs: a plain `claude -p`
 * ran the user's own SessionStart hooks and plugins, and loaded this repo's
 * auto-memory — the developer's notes — into her context. `--setting-sources
 * project` drops the user's settings (and so their plugins and hooks), and
 * auto-memory is switched off outright. Her persona (AGENTS.md) still loads
 * from the cwd — her home, see ears/src/home.ts.
 */
export function claudeArgs(options: ClaudeArgsOptions): string[] {
  const mcp = { mcpServers: { 'avelyn-engine': options.engine } };
  return [
    '-p',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--setting-sources', 'project',
    '--settings', JSON.stringify({ autoMemoryEnabled: false }),
    '--strict-mcp-config',
    '--mcp-config', JSON.stringify(mcp),
    // Read opens the screenshot `look` returns. Nothing else built-in: she is
    // a companion, not a coding agent.
    '--tools', 'Read',
    '--allowedTools', 'mcp__avelyn-engine Read',
    ...(options.model ? ['--model', options.model] : []),
    ...(options.resume ? ['--resume', options.resume] : []),
    ...(options.readDirs ?? []).flatMap((dir) => ['--add-dir', dir]),
  ];
}
