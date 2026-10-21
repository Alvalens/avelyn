import { fileURLToPath, pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createEngineContext, type EngineContext } from './context.ts';
import { runPersonalityAction, remember, recallFacts, listFacts, recallMemories, react, speak, look } from './tools.ts';
import { personalityActions } from '../../bridge/src/actions.ts';

const ENV_PATH = fileURLToPath(new URL('../.env', import.meta.url));

const CORE_CATEGORY = z.enum(['identity', 'preference', 'relationship', 'project', 'fact']);
const EMOTION = z.enum(['happy', 'angry', 'sad', 'relaxed', 'surprised']);

function ok(value: unknown) {
  // structuredContent must be a record, not a bare array — list_actions,
  // recall_facts, list_facts and recall_memories all return arrays.
  const structuredContent = Array.isArray(value)
    ? { items: value }
    : value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : { value };
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
    structuredContent,
  };
}

function toolError(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true };
}

export function createEngineServer(ctx: EngineContext): McpServer {
  const server = new McpServer(
    { name: 'avelyn-engine', version: '0.1.0' },
    {
      capabilities: { tools: {} },
      instructions: [
        "Avelyn's personality actions, voice, and memory.",
        'Call list_actions before using run_action or react with an id you have not seen.',
        "react is preferred over run_action for anything the user will notice — it also logs what happened to recall memory in the same call.",
        'remember and recall_facts are for durable facts (identity, preferences, relationships, projects) — small and always safe to list in full.',
        "recall_memories and react's logging are for episodes and conversation snippets, not durable facts.",
        'look takes a screenshot and returns its path — open the image yourself, and only describe what is really in it.',
        'Avelyn speaks Japanese aloud with English subtitles: write your normal English reply as the chat response (the subtitle), and separately voice a natural Japanese translation of that same line.',
        "If you are also reacting this turn, pass the line as react's speechText instead of calling speak separately — it fires the gesture and the voice together with matching emotion automatically, rather than two sequential calls where the voice only starts once the gesture has already finished. Use the standalone speak tool only when there is no reaction to pair it with this turn, and pass its own emotion/intensity to match the mood of the line in that case.",
      ].join(' '),
    },
  );

  server.registerTool(
    'list_actions',
    {
      title: 'List personality actions',
      description:
        'Every personality action id and what it does. Read-only. Call this before run_action or react with an id you have not seen before.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => ok(personalityActions.map(({ id, description }) => ({ id, description }))),
  );

  server.registerTool(
    'run_action',
    {
      title: 'Run a personality action',
      description:
        "Fire one of Avelyn's personality actions (an expression, and an animation when one is mapped). Auto-resets to idle on its own afterward. Prefer react unless you specifically do not want this logged to memory.",
      inputSchema: {
        action: z.string().min(1).describe('An action id from list_actions.'),
      },
    },
    async ({ action }) => {
      const result = await runPersonalityAction(ctx, action);
      return result.ok ? ok(result) : toolError(result.error ?? 'The action failed.');
    },
  );

  server.registerTool(
    'react',
    {
      title: 'React and remember it',
      description:
        "Fire a personality action and log what happened as an episode in recall memory, in one call. Use note to say what prompted the reaction — omit it when the moment isn't worth remembering, and nothing is logged. Nothing is logged if the action itself fails either. Pass speechText to have her say a line at the same time — preferred over a separate speak call whenever you're also reacting: emotion/intensity are derived automatically from the action so her face and voice always agree, and the voice synthesizes concurrently with the gesture instead of only starting once it's already finished.",
      inputSchema: {
        action: z.string().min(1).describe('An action id from list_actions.'),
        note: z.string().min(1).optional().describe("Why Avelyn reacted this way — stored as the episode's content."),
        speechText: z.string().min(1).optional().describe('A Japanese line to speak at the same time as the reaction, if any.'),
        speakerId: z.number().int().optional().describe('VOICEVOX speaker/style id for speechText — defaults to VOICEVOX_SPEAKER_ID from .env.'),
      },
    },
    async ({ action, note, speechText, speakerId }) => {
      const result = await react(ctx, action, note, undefined, speechText ? { text: speechText, speakerId } : undefined);
      return result.action.ok ? ok(result) : toolError(result.action.error ?? 'The action failed.');
    },
  );

  server.registerTool(
    'speak',
    {
      title: 'Speak a line out loud',
      description:
        "Speak text out loud through VOICEVOX (local TTS engine, must already be running). Pass the Japanese translation of your reply — the English stays in the chat response as the subtitle. Does not log to memory or touch the avatar. If you're also calling react this turn, use its speechText instead — it fires the gesture and the voice together instead of one after the other, and matches emotion to the action automatically.",
      inputSchema: {
        text: z.string().min(1).describe('The Japanese line to voice.'),
        speakerId: z.number().int().optional().describe('VOICEVOX speaker/style id — defaults to VOICEVOX_SPEAKER_ID from .env.'),
        emotion: EMOTION.optional().describe(
          'The mood to voice the line with — same vocabulary as expression.set/run_action. Omit for flat/neutral delivery.',
        ),
        intensity: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .describe('How strongly to apply emotion, 0-1 (defaults to 1). Ignored without emotion. Match a run_action weight if one applies.'),
      },
    },
    async ({ text, speakerId, emotion, intensity }) => {
      try {
        await speak(ctx, text, speakerId, { emotion, intensity });
        return ok({ spoke: text, emotion: emotion ?? 'neutral' });
      } catch (error) {
        return toolError(error instanceof Error ? error.message : String(error));
      }
    },
  );

  server.registerTool(
    'look',
    {
      title: 'Look at the screen',
      description:
        "Take a screenshot of the user's screen and return the file path. Open that image file and describe only what you can actually see in it — never guess at what is on screen. Use it when the user asks you to look at something. It refuses, and says so, when looking is switched off or the window in front is on the blocklist; tell the user plainly that you can't see right now instead of making anything up.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const result = await look(ctx);
      return result.ok
        ? ok({ path: result.path, note: 'Open this image file and describe only what you can actually see in it.' })
        : toolError(result.message);
    },
  );

  server.registerTool(
    'remember',
    {
      title: 'Remember a fact',
      description:
        "Save a durable fact — identity, a preference, a relationship, a project, or a general fact. Not for conversation snippets or one-off events; use react's note or recall_memories for those.",
      inputSchema: {
        category: CORE_CATEGORY,
        content: z.string().min(1).describe('The fact itself.'),
        subject: z
          .string()
          .min(1)
          .optional()
          .describe("A short label — a person's name for a relationship, a project name for a project."),
      },
    },
    async ({ category, content, subject }) => ok(remember(ctx, { category, content, subject })),
  );

  server.registerTool(
    'recall_facts',
    {
      title: 'Search durable facts',
      description:
        'Search identity/preference/relationship/project/fact memories by keyword or phrase. Use this before remember, to check whether something similar is already known.',
      inputSchema: { query: z.string().min(1) },
      annotations: { readOnlyHint: true },
    },
    async ({ query }) => ok(recallFacts(ctx, query)),
  );

  server.registerTool(
    'list_facts',
    {
      title: 'List durable facts',
      description: 'Every durable fact, or every fact in one category. Small by design — safe to call in full.',
      inputSchema: { category: CORE_CATEGORY.optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ category }) => ok(listFacts(ctx, category)),
  );

  server.registerTool(
    'recall_memories',
    {
      title: 'Search episodes and conversations',
      description:
        'Search past episodes and conversation snippets by keyword or phrase — not durable facts, use recall_facts for those.',
      inputSchema: { query: z.string().min(1) },
      annotations: { readOnlyHint: true },
    },
    async ({ query }) => ok(recallMemories(ctx, query)),
  );

  return server;
}

async function main() {
  try {
    process.loadEnvFile(ENV_PATH);
  } catch {
    // Optional: vars may already be supplied by the MCP host's own config.
  }

  const ctx = createEngineContext();
  const server = createEngineServer(ctx);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Same Windows-safe entry-point check bridge/server.ts needed — comparing
// against a raw `file://${process.argv[1]}` breaks on Windows path separators.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
