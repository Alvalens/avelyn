import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfigFromEnv, REPO_ROOT } from './config.ts';
import { transcribe } from './transcribe.ts';
import { createBrain, resolveProvider } from './brain/index.ts';
import { preparePersona } from './home.ts';
import { CAPTURES_DIR } from '../../vision/src/paths.ts';
import { greetingPrompt } from './greeting.ts';
import { Initiative } from './initiative.ts';
import { createPartialEmitter } from './partial.ts';
import { foreground } from '../../vision/src/foreground.ts';
import { holdNoLook } from '../../vision/src/nolook.ts';
import { NO_LOOK_PATH } from '../../vision/src/paths.ts';
import { loadSettings } from '../../vision/src/settings.ts';
import { listCoreMemory, openMemoryStore } from '../../memory/src/memoryStore.ts';
import { DB_PATH } from '../../memory/src/paths.ts';

/**
 * The voice pipeline the avatar app's push-to-talk drives (electron/voice-hud.cjs).
 *
 * Electron 34 embeds Node 20, which cannot strip types, so the Electron main
 * process cannot import `ears/` directly. Rather than add a loader dependency,
 * this runs as a Node 24 child and the two speak newline-delimited JSON.
 *
 * It also means her brain session (agy, Claude Code or Codex — see brain/)
 * outlives any single window: it is owned here, not by the renderer.
 */

const config = loadConfigFromEnv();

/** How often the initiative gate is looked at. Most ticks cost nothing. */
const INITIATIVE_TICK_MS = 60_000;

function emit(event: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(event) + '\n');
}

// Her persona is copied into her home on every start, so an edit to
// persona/AGENTS.md reaches the next session.
if (config.ownHome) preparePersona(config.cwd, REPO_ROOT);
// The chosen CLI, or an installed one if it is not (see resolveProvider).
const brain = resolveProvider(config.brain);
if (brain.provider !== config.brain.provider) {
  console.error(`brain: ${config.brain.provider} is not installed - using ${brain.provider}`);
}
const session = createBrain(brain, { cwd: config.cwd, readDirs: [CAPTURES_DIR] });
console.error(`brain: ${brain.provider}${brain.model ? ` (${brain.model})` : ''}${brain.resume ? ', resuming' : ''}`);

/** The last session id reported to the app, which hands it back if it has to restart us. */
let reportedSession: string | null = null;
/** The last model reported, for the bubble — refined once the CLI says what it really runs. */
let reportedModel: string | null | undefined;
function reportSession(): void {
  if (session.model !== reportedModel) {
    reportedModel = session.model;
    emit({ type: 'brain', provider: brain.provider, model: session.model });
  }
  if (!session.sessionId || session.sessionId === reportedSession) return;
  reportedSession = session.sessionId;
  emit({ type: 'session', id: session.sessionId });
}
// What was asked for (or agy's own default) is known now; Claude and Codex
// name the exact model once the session is up.
reportSession();

// Spawned at startup and left to warm. Measured on this machine: the first
// turn costs ~26s against ~3s warm, so paying it at launch beats paying it
// when the user has just finished a sentence.
emit({ type: 'ready' });

interface AskCommand {
  type: 'ask';
  pcmPath: string;
  sampleRate?: number;
  /** Raw peak before the HUD's gain — see transcribe's `inputPeak`. */
  inputPeak?: number;
}

let queue: Promise<void> = Promise.resolve();
/** Jobs queued or running — the initiative gate must not add to a busy session. */
let pending = 0;

/**
 * Report a failed turn — and if it failed because the brain itself is gone,
 * exit so the host starts a fresh pipeline (and brain) instead of keeping a dead one.
 */
function fail(error: Error): void {
  emit({ type: 'error', message: error.message });
  if (session.died) process.exit(1);
}

/** One job at a time, matching the session's own one-turn-at-a-time contract. */
function enqueue(job: () => Promise<void>): void {
  pending += 1;
  queue = queue
    .then(job)
    .then(reportSession)
    .catch(fail)
    .finally(() => {
      pending -= 1;
    });
}

const initiative = new Initiative({
  now: () => Date.now(),
  random: () => Math.random(),
  settings: () => loadSettings(),
  foreground: () => foreground(),
  // Called from inside a queued job, which counts itself.
  busy: () => pending > 1,
  ask: (prompt) => session.ask(prompt),
  say: (text) => emit({ type: 'remark', text }),
  holdLook: (hold) => holdNoLook(NO_LOOK_PATH, hold),
});

const partials = createPartialEmitter((text) => emit({ type: 'partial', text }));

/**
 * A turn the user is waiting on: her words go to the bubble as she writes them
 * rather than all at once at the end. Not used for unprompted nudges — her
 * answer there might be `[quiet]`, and half of it shown first would be text
 * she then takes back. `cancel` in `finally` so a late piece can never land
 * on top of the final reply (or of an error).
 */
async function askStreaming(prompt: string): Promise<string> {
  try {
    return await session.ask(prompt, { onText: (text) => partials.push(text.trim()) });
  } finally {
    partials.cancel();
  }
}

async function handleAsk(command: AskCommand): Promise<void> {
  initiative.noteUserActivity();

  const raw = await readFile(command.pcmPath);
  const pcm = new Int16Array(raw.buffer, raw.byteOffset, Math.floor(raw.length / 2));

  const heard = await transcribe(pcm, {
    binaryPath: config.whisperBinaryPath,
    modelPath: config.whisperModelPath,
    prompt: config.prompt,
    sampleRate: command.sampleRate ?? 16000,
    inputPeak: typeof command.inputPeak === 'number' ? command.inputPeak : undefined,
    // Kept so the audio behind a bad transcript can actually be listened to.
    // Overwritten each turn; only the most recent is worth having.
    keepPath: join(tmpdir(), 'avelyn-last-heard.wav'),
  });

  if (heard.silent) {
    emit({ type: 'silent' });
    return;
  }

  // Emitted before the turn is sent so the bubble can show what she was
  // actually told while she is thinking — otherwise a mishearing is
  // indistinguishable from her misunderstanding.
  emit({ type: 'transcript', text: heard.text });

  const reply = await askStreaming(heard.text);
  emit({ type: 'reply', text: reply.trim() });
}

/** Her durable memories of the user, for the launch note. A greeting without them beats no greeting. */
function knownFacts(): string[] {
  try {
    const db = openMemoryStore(DB_PATH);
    try {
      return listCoreMemory(db).map((memory) => memory.content);
    } finally {
      db.close();
    }
  } catch (error) {
    // stderr, not an event: the app logs it as [pipeline] and the bubble never sees it.
    console.error(`memory unavailable for the greeting: ${(error as Error).message}`);
    return [];
  }
}

// A fresh start greets; a restart after a crash does not (the host only sets
// this on the first spawn). Queued like any turn, so speaking to her while she
// is still saying hello just waits its turn rather than interleaving.
if (process.env.AVELYN_GREET === '1') {
  enqueue(async () => {
    emit({ type: 'greeting' });
    const reply = await askStreaming(greetingPrompt(new Date(), knownFacts()));
    emit({ type: 'reply', text: reply.trim() });
  });
}

setInterval(() => {
  if (pending > 0) return;
  enqueue(async () => {
    await initiative.tick();
    // An unprompted turn that found the brain dead still has to restart the pipeline.
    if (session.died) throw new Error('brain process exited');
  });
}, INITIATIVE_TICK_MS).unref();

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => {
  buffer += chunk;
  for (let at = buffer.indexOf('\n'); at >= 0; at = buffer.indexOf('\n')) {
    const line = buffer.slice(0, at);
    buffer = buffer.slice(at + 1);
    if (!line.trim()) continue;

    let command: AskCommand | { type: 'close' } | { type: 'activity' };
    try {
      command = JSON.parse(line);
    } catch {
      continue;
    }

    if (command.type === 'close') {
      session.close();
      process.exit(0);
    }

    if (command.type === 'activity') {
      initiative.noteUserActivity();
      continue;
    }

    if (command.type === 'ask') {
      const ask = command as AskCommand;
      enqueue(() => handleAsk(ask));
    }
  }
});

process.stdin.on('end', () => {
  // Drain before exiting. Exiting on 'end' directly would throw away a turn
  // already in flight — a query gets answered, then nothing ever comes back.
  queue.finally(() => {
    session.close();
    process.exit(0);
  });
});
