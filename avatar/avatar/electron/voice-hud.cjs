const { BrowserWindow, globalShortcut, ipcMain, screen, session } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  brainLabel,
  gestureFor,
  normalizeBrainSettings,
  normalizeVoiceSettings,
  parsePipelineLine,
  pipelineEnv,
  shouldShowPartial,
  shouldShowRemark,
  stateForPipelineEvent,
} = require('./voice-hud-logic.cjs');
const { updateRuntime } = require('./runtime-file.cjs');

/**
 * Push-to-talk, hosted by the avatar app (it used to be the separate hud/
 * app). Owns the three things only Electron can do — the global hotkey, the
 * microphone (inside the bubble window) and the bubble — plus the child
 * running ears/src/pipeline.ts, which does STT and holds her brain's session
 * (agy, Claude Code or Codex — the `brain` section of config.yaml).
 * Decisions live in voice-hud-logic.cjs (tested); this file is side effects.
 */

const HUD_WIDTH = 460;
const HUD_HEIGHT = 132;
// About ten lines of reply; anything longer scrolls inside the bubble.
const HUD_MAX_HEIGHT = 300;
// Its own session: the bubble is granted the microphone unconditionally (it
// cannot take focus, so nobody could answer a prompt), and doing that on the
// default session would grant it to the stage window as well.
const PARTITION = 'voice-hud';
const RENDERER_DIR = path.join(__dirname, 'voice-hud');
// avatar/avatar/electron -> <repo>\ears\src\pipeline.ts
const PIPELINE_SCRIPT = path.resolve(__dirname, '..', '..', '..', 'ears', 'src', 'pipeline.ts');
const RESTART_DELAY_MS = 1000;
// The pipeline ends agy itself on `close`; killing it outright first would
// orphan agy, because on Windows a child outlives a killed parent.
const STOP_GRACE_MS = 3000;

let settings = { ...normalizeVoiceSettings(null), enabled: false };
let brain = normalizeBrainSettings(null);
// Her brain's conversation id, as the running pipeline last reported it.
// Handed to a pipeline restarted after a crash, so she carries on mid-thread.
let lastSession = null;
// What the running pipeline says it is on, shown in the bubble's corner.
let running = null;
let bubble = null;
let pipeline = null;
let restartTimer = null;
let scratch = null;
let registeredHotkey = null;
let listening = false;
let busy = false;
let pendingState = null;
let diagnostic = null;
// `mics` is every input label the bubble can see, for the Settings dropdown.
let status = { hotkeyRegistered: false, pipeline: 'stopped', mic: null, mics: [], error: null };
let statusListener = () => {};
let gestureListener = () => {};

/**
 * main.cjs resolves these against the stage and applies them — this file
 * knows *when* she should look like she is listening, not how a pose plays.
 */
function onVoiceHudGesture(listener) {
  gestureListener = listener;
}

function gesture(moment) {
  const command = gestureFor(moment);
  if (command) gestureListener(command);
}

function voiceHudStatus() {
  return { enabled: settings.enabled, hotkey: settings.hotkey, ...status };
}

function setStatus(patch) {
  status = { ...status, ...patch };
  statusListener(voiceHudStatus());
}

function onVoiceHudStatus(listener) {
  statusListener = listener;
}

// A state sent while the bubble is still loading goes nowhere, which made
// startup failures look identical to the app doing nothing. Held and
// replayed once the page is up.
function send(state) {
  if (!bubble || bubble.isDestroyed()) return;
  if (bubble.webContents.isLoading()) {
    pendingState = state;
    return;
  }
  bubble.webContents.send('hud:state', state);
  // A transparent, non-focusable, always-on-top window can sit on a stale frame
  // until something else on screen (the avatar window being touched) wakes the
  // compositor. Seen live: the bubble showed an old reply for ~45s while the
  // new one had already been delivered. Asking for a repaint on every state
  // makes the update show up when it happens.
  bubble.webContents.invalidate();
}

function sendBrain() {
  if (!bubble || bubble.isDestroyed() || bubble.webContents.isLoading()) return;
  bubble.webContents.send('hud:brain', { label: brainLabel(running) });
  bubble.webContents.invalidate();
}

/**
 * Put the bubble back in front of the stage window. Windows has a single
 * always-on-top band — the 'screen-saver' level only means something on
 * macOS — so whichever topmost window was activated last is in front. Clicking
 * into the stage (Settings, say) put it above the bubble, and the stage's
 * transparent area still takes clicks: wherever the two overlapped, a drag on
 * the bubble went to the stage instead. Measured 2026-10-20 with
 * WindowFromPoint/WM_NCHITTEST. moveTop does not take focus.
 */
function raiseBubble() {
  if (bubble && !bubble.isDestroyed()) bubble.moveTop();
}

function fromBubble(event) {
  return bubble != null && !bubble.isDestroyed() && event.sender === bubble.webContents;
}

function createBubble({ show = true, extraArgs = [] } = {}) {
  session.fromPartition(PARTITION).setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media');
  });

  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  bubble = new BrowserWindow({
    show,
    width: HUD_WIDTH,
    height: HUD_HEIGHT,
    x: Math.round((width - HUD_WIDTH) / 2),
    y: height - HUD_HEIGHT - 90,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    // A status display, not a window you work in: taking focus away from
    // whatever you are doing would be worse than useless.
    focusable: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(RENDERER_DIR, 'preload.cjs'),
      partition: PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      // Never throttle: the bubble is only ever seen while something else (a
      // game, a terminal) is in front, which is exactly when Chromium would.
      backgroundThrottling: false,
      // The renderer owns getUserMedia; an argument keeps preload synchronous.
      additionalArguments: [
        `--avelyn-mic=${settings.micLabel}`,
        ...(settings.autoStop ? ['--avelyn-auto-stop'] : []),
        ...extraArgs,
      ],
    },
  });
  bubble.setAlwaysOnTop(true, 'screen-saver');

  // Renderer errors are otherwise invisible in a window with no devtools.
  // Electron 35 moved the details onto the event; `level` is now a string.
  bubble.webContents.on('console-message', ({ level, message, lineNumber, sourceId }) => {
    console.log(`[voice-hud:${level}] ${message} (${sourceId}:${lineNumber})`);
  });
  bubble.webContents.on('did-finish-load', () => {
    // A bubble recreated for a new mic still shows what she runs on.
    sendBrain();
    if (!pendingState || !bubble) return;
    const state = pendingState;
    pendingState = null;
    bubble.webContents.send('hud:state', state);
  });
  bubble.on('closed', () => {
    bubble = null;
    listening = false;
  });

  bubble.loadFile(path.join(RENDERER_DIR, 'index.html'));
}

function destroyBubble() {
  if (bubble && !bubble.isDestroyed()) bubble.destroy();
  bubble = null;
  listening = false;
  pendingState = null;
}

function handlePipelineEvent(event) {
  if (event?.type === 'partial' && !shouldShowPartial({ listening })) return;
  if (event?.type === 'remark' && !shouldShowRemark({ listening, busy })) {
    console.log('[remark] held back: the user is mid-turn');
    return;
  }
  const outcome = stateForPipelineEvent(event);
  if (!outcome) return;
  if (outcome.session) {
    lastSession = outcome.session;
    return;
  }
  if (outcome.brain) {
    running = outcome.brain;
    console.log(`[voice-hud] running on ${brainLabel(running)}`);
    sendBrain();
    return;
  }
  if (outcome.log) console.log(outcome.log);
  if (outcome.done) {
    busy = false;
    gesture('settled');
  }
  if (outcome.ready) setStatus({ pipeline: 'ready' });
  send(outcome.hud);
}

/** @param {{ greet?: boolean }} [options] greet on a fresh start, never on a restart */
function startPipeline({ greet = false } = {}) {
  restartTimer = null;
  if (status.pipeline !== 'restarting') setStatus({ pipeline: 'starting' });

  // The system Node, not Electron's: Electron 34 bundles Node 20, which
  // cannot strip TypeScript types.
  const child = spawn('node', ['--no-warnings', PIPELINE_SCRIPT], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    // A fresh start is a fresh conversation. A restart after a crash resumes
    // the last one — once: if resuming is what keeps failing, the next
    // restart starts clean rather than looping on it.
    env: { ...process.env, AVELYN_GREET: greet ? '1' : '', ...pipelineEnv(brain, greet ? null : takeLastSession()) },
  });
  pipeline = child;
  // A write to a child that has just died raises EPIPE as an event; unhandled
  // in the main process it is an uncaught exception.
  child.stdin.on('error', () => {});

  let buffer = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    for (let at = buffer.indexOf('\n'); at >= 0; at = buffer.indexOf('\n')) {
      const line = buffer.slice(0, at);
      buffer = buffer.slice(at + 1);
      handlePipelineEvent(parsePipelineLine(line));
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => console.error('[pipeline]', chunk.trimEnd()));

  child.on('error', (error) => {
    setStatus({ error: `voice pipeline failed to start: ${error.message}` });
  });
  child.on('exit', () => {
    // A deliberate stop has already let go of this child.
    if (pipeline !== child) return;
    pipeline = null;
    busy = false;
    if (!settings.enabled) return;
    setStatus({ pipeline: 'restarting' });
    send({ state: 'error', message: 'brain stopped — restarting' });
    gesture('settled');
    // No greeting: she was already here, it is the brain behind her that restarted.
    restartTimer = setTimeout(() => startPipeline(), RESTART_DELAY_MS);
  });
}

function takeLastSession() {
  const id = lastSession;
  lastSession = null;
  return id;
}

function stopPipeline() {
  clearTimeout(restartTimer);
  restartTimer = null;
  const child = pipeline;
  pipeline = null;
  busy = false;
  if (!child) return;
  try {
    child.stdin.write(JSON.stringify({ type: 'close' }) + '\n');
    child.stdin.end();
  } catch {
    // Already gone.
  }
  setTimeout(() => {
    if (child.exitCode === null) child.kill();
  }, STOP_GRACE_MS).unref();
}

function toggleListening() {
  if (listening) {
    listening = false;
    send({ state: 'transcribing' });
    gesture('thinking');
    bubble?.webContents.send('hud:stop-recording');
    return;
  }
  if (busy) {
    // Turns are serialized; cancelling mid-turn is a separate feature.
    send({ state: 'busy' });
    return;
  }
  listening = true;
  raiseBubble();
  // So she is never nudged while the user is mid-sentence.
  pipeline?.stdin.write(JSON.stringify({ type: 'activity' }) + '\n');
  send({ state: 'listening' });
  gesture('listening');
  bubble?.webContents.send('hud:start-recording');
}

function releaseHotkey() {
  if (!registeredHotkey) return;
  globalShortcut.unregister(registeredHotkey);
  registeredHotkey = null;
}

function registerHotkey() {
  releaseHotkey();
  let ok = false;
  try {
    ok = globalShortcut.register(settings.hotkey, toggleListening);
  } catch {
    // An invalid accelerator throws rather than returning false.
    ok = false;
  }
  if (ok) registeredHotkey = settings.hotkey;
  console.log(ok
    ? `[voice-hud] hotkey registered: ${settings.hotkey}`
    : `[voice-hud] FAILED to register hotkey ${settings.hotkey}`);
  setStatus({
    hotkeyRegistered: ok,
    error: ok ? null : `Hotkey ${settings.hotkey} is taken by another app, or not a valid shortcut.`,
  });
  if (!ok) send({ state: 'error', message: `hotkey ${settings.hotkey} is taken` });
}

/**
 * Publish the app's `vision` section for the Node 24 processes (the engine and
 * the pipeline), which cannot read config.yaml — in the runtime file
 * (runtime-file.cjs). They re-read it on every use, so a toggle takes effect
 * without a restart. Written even when push-to-talk is off: `look` also works
 * from a typed session.
 */
function writeVisionSettings(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
  updateRuntime({ vision: raw });
}

function configureVoiceHud(raw) {
  writeVisionSettings(raw?.vision);
  const next = normalizeVoiceSettings(raw);
  const previous = settings;
  settings = next;
  const nextBrain = normalizeBrainSettings(raw?.brain);
  const brainChanged = nextBrain.provider !== brain.provider || nextBrain.model !== brain.model;
  brain = nextBrain;

  if (!next.enabled) {
    stopVoiceHud();
    return voiceHudStatus();
  }

  if (!previous.enabled) {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'avelyn-hud-'));
    createBubble();
    startPipeline({ greet: true });
    registerHotkey();
    return voiceHudStatus();
  }

  if (brainChanged) {
    // A different brain is a different her: new conversation, new greeting.
    console.log(`[voice-hud] brain is now ${brain.provider}${brain.model ? ` (${brain.model})` : ''}`);
    lastSession = null;
    gesture('settled');
    stopPipeline();
    startPipeline({ greet: true });
  }

  if (previous.hotkey !== next.hotkey) registerHotkey();
  if (previous.micLabel !== next.micLabel || previous.autoStop !== next.autoStop) {
    // Both reach the renderer as process arguments, so a change means a new
    // bubble. The pipeline and its warm agy session are untouched.
    destroyBubble();
    // A "no mic matching" about the old choice no longer applies; a hotkey
    // failure still does.
    setStatus({ mic: null, error: registeredHotkey ? null : status.error });
    createBubble();
  }
  return voiceHudStatus();
}

function stopVoiceHud() {
  // Before anything else: a pose held for a turn that will now never finish
  // would otherwise stay on stage.
  if (settings.enabled) gesture('settled');
  settings = { ...settings, enabled: false };
  releaseHotkey();
  stopPipeline();
  destroyBubble();
  if (scratch) {
    fs.rmSync(scratch, { recursive: true, force: true });
    scratch = null;
  }
  status = { hotkeyRegistered: false, pipeline: 'stopped', mic: null, mics: [], error: null };
  statusListener(voiceHudStatus());
}

// ---- IPC from the bubble -------------------------------------------------

// The renderer hands back raw 16 kHz mono PCM; writing it here and passing a
// path keeps the pipeline protocol to JSON.
ipcMain.on('hud:pcm', (event, buffer, sampleRate, levels) => {
  if (!fromBubble(event) || busy) return;
  if (!pipeline || !scratch) {
    send({ state: 'error', message: 'her session is not running' });
    gesture('settled');
    return;
  }
  busy = true;

  // Logged because it separates "she misheard" from "she was handed a
  // near-silent recording" — identical from the transcript alone.
  if (levels) {
    const { peak, rms, gain, seconds } = levels;
    console.log(`[turn] ${seconds.toFixed(1)}s peak=${peak.toFixed(4)} rms=${rms.toFixed(5)} gain=${gain.toFixed(1)}x`);
  }

  const pcmPath = path.join(scratch, 'rec.raw');
  fs.writeFileSync(pcmPath, Buffer.from(buffer));
  send({ state: 'transcribing' });
  // inputPeak is the level *before* the bubble's gain: it is what tells a real
  // "thank you" from whisper hallucinating one over silence.
  const inputPeak = typeof levels?.peak === 'number' ? levels.peak : undefined;
  pipeline.stdin.write(JSON.stringify({ type: 'ask', pcmPath, sampleRate, inputPeak }) + '\n');
});

// A mis-tap (too short to be a sentence) is dropped in the bubble, so nothing
// reaches the pipeline and no turn will ever settle the thinking pose.
ipcMain.on('hud:discarded', (event) => {
  if (!fromBubble(event)) return;
  gesture('settled');
  send({ state: 'idle' });
});

// The bubble ended a recording itself (silence after speech, the length cap,
// or nothing said at all) — the same moment as a second tap, minus the tap.
ipcMain.on('hud:auto-stop', (event, reason) => {
  if (!fromBubble(event) || !listening) return;
  listening = false;
  console.log(`[voice-hud] recording ended on its own: ${reason}`);
  if (reason === 'nothing') {
    gesture('settled');
    send({ state: 'idle', note: "didn't hear anything" });
    return;
  }
  send({ state: 'transcribing' });
  gesture('thinking');
});

// Grows upward from where the bubble sits, so its bottom edge stays put
// (it may have been dragged), and never past HUD_MAX_HEIGHT.
ipcMain.on('hud:resize', (event, wanted) => {
  if (!fromBubble(event) || typeof wanted !== 'number' || !Number.isFinite(wanted)) return;
  const height = Math.round(Math.min(HUD_MAX_HEIGHT, Math.max(HUD_HEIGHT, wanted)));
  const bounds = bubble.getBounds();
  if (bounds.height === height) return;
  // A non-resizable window refuses programmatic resizes on some platforms.
  bubble.setResizable(true);
  bubble.setBounds({ ...bounds, y: bounds.y + bounds.height - height, height });
  bubble.setResizable(false);
});

ipcMain.on('hud:no-mic', (event, message) => {
  if (!fromBubble(event)) return;
  listening = false;
  gesture('settled');
  const text = message || 'no microphone';
  setStatus({ error: text });
  send({ state: 'error', message: text });
});

ipcMain.on('hud:mics', (event, devices) => {
  if (!fromBubble(event)) return;
  const selected = devices.find((device) => device.isSelected);
  if (diagnostic?.mode === 'list-mics') {
    printMics(devices);
    diagnostic.app.quit();
    return;
  }
  setStatus({ mic: selected?.label ?? null, mics: devices.map((device) => device.label) });
});

ipcMain.on('hud:mic-test', (event, result) => {
  if (!fromBubble(event) || diagnostic?.mode !== 'mic-test') return;
  printMicTest(result);
  diagnostic.app.quit();
});

ipcMain.on('hud:capture-test', (event, result) => {
  if (!fromBubble(event) || diagnostic?.mode !== 'capture-test') return;
  printCaptureTest(result);
  diagnostic.app.quit();
});

// ---- One-shot diagnostics (`npm run voice:mics` etc.) ----------------------

function runVoiceDiagnostic(mode, micLabel, app) {
  settings = { ...normalizeVoiceSettings({ micLabel }), enabled: false };
  diagnostic = { mode, app };
  const extraArgs = mode === 'mic-test'
    ? ['--avelyn-mic-test']
    : mode === 'capture-test' ? ['--avelyn-capture-test'] : [];
  createBubble({ show: false, extraArgs });
}

function printMics(devices) {
  console.log('\nMicrophones this app can see:\n');
  for (const [index, device] of devices.entries()) {
    const marks = [device.isDefault ? 'system default' : '', device.isSelected ? 'IN USE' : '']
      .filter(Boolean).join(', ');
    console.log(`  [${index}] ${device.label}${marks ? `   (${marks})` : ''}`);
  }
  console.log(settings.micLabel
    ? `\nConfigured mic: "${settings.micLabel}"`
    : '\nNo mic configured - using whatever Windows calls default.');
  console.log('Set it in the app: Settings -> Voice input -> Microphone.\n');
}

function printMicTest(result) {
  if (!result.ok) {
    console.log(`\n  FAILED: ${result.error}\n`);
    return;
  }
  // A device that opens but never leaves zero is wired up but hearing nothing.
  const verdict = result.peak < 0.001 ? 'SILENT - it opened, but no audio is reaching it' : 'hearing something';
  console.log(`\n  device:     ${result.label}`);
  console.log(`  sampleRate: ${result.sampleRate}`);
  console.log(`  chunks:     ${result.chunks}`);
  console.log(`  peak:       ${result.peak.toFixed(4)}   (${verdict})`);
  console.log(`  rms:        ${result.rms.toFixed(5)}\n`);
}

function printCaptureTest(result) {
  if (!result.ok) {
    console.log(`\n  FAILED: ${result.error}\n`);
    return;
  }
  console.log(`\n  device: ${result.label}\n`);
  console.log('  cycle   wall    audio    ratio');
  for (const [index, cycle] of result.cycles.entries()) {
    const ratio = cycle.audioSeconds / cycle.seconds;
    console.log(`    ${index + 1}   ${cycle.seconds.toFixed(2)}s   ${cycle.audioSeconds.toFixed(2)}s   ${ratio.toFixed(2)}x`);
  }
  const last = result.cycles.at(-1);
  console.log(last.audioSeconds / last.seconds > 1.25
    ? '\n  FAIL - audio grows with each cycle; recordings are not independent.\n'
    : '\n  PASS - every cycle captured roughly its own duration.\n');
}

module.exports = {
  configureVoiceHud,
  raiseBubble,
  onVoiceHudGesture,
  onVoiceHudStatus,
  runVoiceDiagnostic,
  stopVoiceHud,
};
