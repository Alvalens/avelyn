/**
 * The decisions behind push-to-talk, kept free of Electron so `node --test`
 * can load them. voice-hud.cjs does the side effects.
 */

/** Keep in step with defaultVoiceHotkey in src/config/voiceHud.js. */
const DEFAULT_VOICE_HOTKEY = 'Control+Alt+Space';

/** Mirrors normalizeVoiceHud in src/config/voiceHud.js: an IPC payload is
 * checked here rather than trusted. */
function normalizeVoiceSettings(raw) {
  const data = raw && typeof raw === 'object' ? raw : {};
  const hotkey = typeof data.hotkey === 'string' ? data.hotkey.trim() : '';
  return {
    enabled: data.enabled !== false,
    hotkey: hotkey || DEFAULT_VOICE_HOTKEY,
    micLabel: typeof data.micLabel === 'string' ? data.micLabel.trim() : '',
    autoStop: data.autoStop !== false,
  };
}

const BRAIN_PROVIDERS = ['agy', 'claude', 'codex'];

/** Mirrors normalizeBrain in src/config/brain.js. */
function normalizeBrainSettings(raw) {
  const data = raw && typeof raw === 'object' ? raw : {};
  if (!BRAIN_PROVIDERS.includes(data.provider)) return { provider: 'agy', model: '' };
  return { provider: data.provider, model: typeof data.model === 'string' ? data.model.trim() : '' };
}

/**
 * What the pipeline is told about its brain — read by ears/src/config.ts.
 * `resume` is only ever set when restarting a pipeline that crashed, so she
 * picks the same conversation back up; a fresh start is a fresh conversation.
 */
function pipelineEnv(brain, resume) {
  return {
    AVELYN_BRAIN: brain.provider,
    AVELYN_BRAIN_MODEL: brain.model,
    AVELYN_RESUME: resume || '',
  };
}

/** "claude · claude-sonnet-5-5": the corner of the bubble. The model is left off when unknown. */
function brainLabel(brain) {
  if (!brain || !brain.provider) return '';
  return brain.model ? `${brain.provider} · ${brain.model}` : brain.provider;
}

function parsePipelineLine(line) {
  if (!line || !line.trim()) return null;
  try {
    const value = JSON.parse(line);
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

/**
 * What one pipeline event means for the bubble. `done` ends the turn — the
 * hotkey is refused with "busy" until it does, since turns are serialized.
 */
function stateForPipelineEvent(event) {
  switch (event?.type) {
    case 'ready':
      return { hud: { state: 'idle' }, ready: true };
    case 'greeting':
      // Her launch greeting is being written; nothing was heard, so there is
      // no transcript to show. Its reply arrives as an ordinary `reply`.
      return { hud: { state: 'thinking' } };
    case 'transcript':
      // Shown while she thinks, so a mishearing is visible rather than
      // presenting as her answering something you didn't say.
      return {
        hud: { state: 'thinking', transcript: event.text },
        log: `[heard] "${event.text}"`,
      };
    case 'silent':
      return {
        hud: { state: 'idle', note: "didn't catch that" },
        done: true,
        log: '[heard] (nothing - treated as silence)',
      };
    case 'reply':
      return { hud: { state: 'reply', text: event.text }, done: true, log: `[reply] "${event.text}"` };
    case 'partial':
      // Her words as she writes them. Shown like a reply but ends nothing —
      // the turn, its pose and `busy` are still running until the real reply —
      // and not logged: there are dozens per turn.
      return { hud: { state: 'reply', text: event.text } };
    case 'remark':
      // She spoke first. Unlike `reply` this ends nothing: no turn was running
      // for it, and one the user is in the middle of must not be cut short.
      return { hud: { state: 'reply', text: event.text }, log: `[remark] "${event.text}"` };
    case 'error':
      return { hud: { state: 'error', message: event.message }, done: true, log: `[ERROR] ${event.message}` };
    case 'brain':
      // Which brain and model she runs on — for the bubble's corner, not a turn.
      return { brain: { provider: event.provider, model: event.model ?? null } };
    case 'session':
      // Her brain's conversation id — kept by main for a crash-restart, never shown.
      return typeof event.id === 'string' && event.id ? { session: event.id } : null;
    default:
      return null;
  }
}

/**
 * An unprompted remark replaces whatever the bubble shows, so it waits its
 * turn: never over a recording in progress or a turn the user is waiting on.
 */
function shouldShowRemark({ listening, busy }) {
  return !listening && !busy;
}

/** Streamed text must not paint over a recording in progress. */
function shouldShowPartial({ listening }) {
  return !listening;
}

/** Combo ids from src/config/poseSequences.js — permanent, hand-chosen. */
const LISTENING_POSE = 'combo-listening';
const THINKING_POSE = 'combo-think';

/**
 * The stage command for a moment in a push-to-talk turn, or null. Held poses
 * last as long as the moment does; `settled` (reply, silence or error) lets
 * go. It releases rather than stops: a reply that came with its own gesture
 * has already replaced the held pose, and must not be cut short.
 */
function gestureFor(moment) {
  switch (moment) {
    case 'listening':
      return { command: 'animation.play', payload: { id: LISTENING_POSE, mode: 'hold' } };
    case 'thinking':
      return { command: 'animation.play', payload: { id: THINKING_POSE, mode: 'hold' } };
    case 'settled':
      return { command: 'animation.release' };
    default:
      return null;
  }
}

const DIAGNOSTIC_FLAGS = {
  '--list-mics': 'list-mics',
  '--mic-test': 'mic-test',
  '--capture-test': 'capture-test',
};

function voiceDiagnosticFromArgv(argv) {
  for (const arg of argv) {
    if (Object.hasOwn(DIAGNOSTIC_FLAGS, arg)) return DIAGNOSTIC_FLAGS[arg];
  }
  return null;
}

module.exports = {
  brainLabel,
  DEFAULT_VOICE_HOTKEY,
  gestureFor,
  normalizeBrainSettings,
  normalizeVoiceSettings,
  parsePipelineLine,
  pipelineEnv,
  shouldShowPartial,
  shouldShowRemark,
  stateForPipelineEvent,
  voiceDiagnosticFromArgv,
};
