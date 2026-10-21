import { runAction, type AutoResetOptions, type RunActionResult } from '../../bridge/src/runAction.ts';
import { postCommand } from '../../bridge/src/agentBusClient.ts';
import { getAction } from '../../bridge/src/actions.ts';
import {
  addCoreMemory,
  listCoreMemory,
  searchCoreMemory,
  addRecallMemory,
  searchRecallMemory,
  type CoreCategory,
  type CoreMemory,
  type RecallMemory,
} from '../../memory/src/memoryStore.ts';
import { speak as synthesize, type Emotion, type SpeakOptions } from '../../voice/src/voicevoxClient.ts';
import { writeTempWav } from '../../voice/src/tempWav.ts';
import { look as visionLook, type LookOptions, type LookResult } from '../../vision/src/look.ts';
import { isNoLook } from '../../vision/src/nolook.ts';
import { loadSettings } from '../../vision/src/settings.ts';
import type { EngineContext } from './context.ts';

export function runPersonalityAction(
  ctx: EngineContext,
  action: string,
  resetOptions?: AutoResetOptions,
): Promise<RunActionResult> {
  return runAction(ctx.bus, action, resetOptions);
}

export function remember(
  ctx: EngineContext,
  input: { category: CoreCategory; content: string; subject?: string | null },
): CoreMemory {
  return addCoreMemory(ctx.db, input);
}

export function recallFacts(ctx: EngineContext, query: string): CoreMemory[] {
  return searchCoreMemory(ctx.db, query);
}

export function listFacts(ctx: EngineContext, category?: CoreCategory): CoreMemory[] {
  return listCoreMemory(ctx.db, category);
}

export function recallMemories(ctx: EngineContext, query: string): RecallMemory[] {
  return searchRecallMemory(ctx.db, query);
}

// text is expected to already be the Japanese line to voice — the English reply
// stays in the normal chat response as the subtitle, translation happens upstream
// (the caller writes both lines in the same turn) rather than in a separate service.
//
// Routed through AVATAR itself (audio.play) rather than played locally: the app
// reads the file, plays it, and drives lip sync directly off that exact clip —
// isolated from whatever else the system happens to be making noise with, which
// OS-loopback capture (the "system" audio source) cannot guarantee on its own.
//
// The same line again within REPEAT_WINDOW_MS is not played twice. Seen live
// on Claude: two identical speak calls in one turn, and a CLI nudging her to
// "continue" after a turn it thought was empty, so she answered again.
const REPEAT_WINDOW_MS = 15_000;

export async function speak(
  ctx: EngineContext,
  text: string,
  speakerId?: number,
  options?: SpeakOptions,
  now: () => number = Date.now,
): Promise<void> {
  const at = now();
  const last = ctx.lastSpoken;
  if (last && last.text.trim() === text.trim() && at - last.at < REPEAT_WINDOW_MS) return;
  ctx.lastSpoken = { text, at };

  const wav = await synthesize(ctx.voice, text, speakerId, options);
  const { path, cleanup } = await writeTempWav(wav);
  try {
    const result = await postCommand(ctx.bus, 'audio.play', { path });
    if (!result.ok) {
      throw new Error(result.error ?? 'audio.play failed.');
    }
  } finally {
    void cleanup();
  }
}

export interface SpeechRequest {
  text: string;
  speakerId?: number;
}

export interface SpeechResult {
  spoke: string;
  emotion?: Emotion;
}

export interface ReactResult {
  action: RunActionResult;
  episode: RecallMemory | null;
  speech?: SpeechResult;
}

// Started alongside runAction, not awaited after it resolves. VOICEVOX's own
// audioQuery+synthesize is the long pole here (~1-1.5s for a typical line —
// see VOICEVOX_DEBUG_TIMING in voice/README.md), far longer than the couple
// bus round trips runAction makes. Calling this sequentially after runAction
// finished was the actual cause of a real bug: by the time her voice was
// ready to play, a short gesture had already finished and reverted to idle,
// so it looked like "animation ends, then she talks" instead of the two
// happening together. Firing both at once means her gesture is already
// playing while the voice synthesizes, so audio typically lands mid-gesture.
async function speakForAction(
  ctx: EngineContext,
  speech: SpeechRequest,
  emotion: Emotion | undefined,
  intensity: number | undefined,
): Promise<SpeechResult> {
  await speak(ctx, speech.text, speech.speakerId, emotion ? { emotion, intensity } : undefined);
  return { spoke: speech.text, emotion };
}

// Only logs the episode when the action actually happened — a failed bridge
// call (unreachable bus, unknown action) would otherwise leave a false memory
// of something that never occurred — and only when she wrote a note: the old
// default ("Reacted with \"think\".") was a recall row that answered nothing.
// Speech is independent of that outcome —
// same as the standalone `speak` tool, it plays regardless — but only carries
// a real `emotion` when the action id actually resolves to one; an unknown
// action still speaks, just delivered flat/neutral rather than blocked.
export async function react(
  ctx: EngineContext,
  action: string,
  note?: string,
  resetOptions?: AutoResetOptions,
  speech?: SpeechRequest,
): Promise<ReactResult> {
  const actionDef = getAction(action);
  // The voice mood is derived separately from the face one: an action whose
  // face has to borrow a VRM preset (`shy_flustered` on `surprised`) can still
  // have its own spoken shape, and borrowing the face's made her sound
  // startled rather than flustered. See VoiceOnlyEmotion in bridge/actions.ts.
  const voiceEmotion = actionDef?.voiceEmotion ?? actionDef?.expressionId;
  const speechPromise = speech
    ? speakForAction(ctx, speech, voiceEmotion, actionDef?.weight)
    : undefined;

  // A held facial expression (e.g. "surprised" at full weight) fighting the
  // mouth's own lip-sync visemes for the whole line reads as a static,
  // uncanny face — confirmed live by the user. The body gesture paired with
  // speech reads fine; the face preset does not. Voice prosody still carries
  // the mood (speakForAction above), just not the face.
  const result = await runAction(ctx.bus, action, resetOptions, { skipExpression: Boolean(speech) });
  const speechResult = speechPromise ? await speechPromise : undefined;

  if (!result.ok || !note) {
    return { action: result, episode: null, speech: speechResult };
  }

  const episode = addRecallMemory(ctx.db, { category: 'episode', content: note });
  return { action: result, episode, speech: speechResult };
}

// Settings are read on every call, not cached: the avatar app rewrites the
// mirror file when the user flips a toggle, and this process outlives that.
export async function look(
  ctx: EngineContext,
  deps?: Pick<LookOptions, 'foreground' | 'grab' | 'now'>,
): Promise<LookResult> {
  const settings = await loadSettings(ctx.vision.settingsPath);
  // Raised by the pipeline while an unprompted turn runs with "look on her own" off.
  const noLook = ctx.vision.noLookPath ? await isNoLook(ctx.vision.noLookPath) : false;
  return visionLook({ settings, dir: ctx.vision.dir, noLook, ...deps });
}
