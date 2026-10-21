/* global hud */

const TARGET_RATE = 16000; // what whisper.cpp expects; it will not resample
const MIN_RECORDING_MS = 400; // below this it is a mis-tap, not a sentence

// Below this the recording is noise floor, not speech. Amplifying it would
// just turn room tone into full-scale hiss for whisper to hallucinate over.
const SILENCE_FLOOR = 0.004;
// Where a normalized recording should peak. Whisper is trained on
// comfortably-loud speech; a line-level input arriving at a fraction of full
// scale is the difference between "transcribes fine" and "plausible nonsense".
const NORMALIZE_CEILING = 0.9;

const el = {
  hud: document.getElementById('hud'),
  body: document.querySelector('.body'),
  label: document.getElementById('label'),
  model: document.getElementById('model'),
  text: document.getElementById('text'),
};

const LABELS = {
  idle: 'Avelyn',
  listening: 'Listening',
  transcribing: 'Hearing you',
  thinking: 'Thinking',
  reply: 'Avelyn',
  error: 'Problem',
};

let audioContext = null;
let level = 0;
let preferredDeviceId = null;

/**
 * The in-progress recording, or null. One object rather than loose module
 * variables so that everything belonging to a recording is created and
 * destroyed together — see the note in startRecording for what went wrong
 * when these were shared.
 */
let session = null;

/**
 * Resolve which microphone to use, once at startup.
 *
 * Permission has to be requested before enumerating: until the origin is
 * granted, every device comes back with an empty label, so there is no way to
 * match a configured name against them.
 */
async function initMicrophone() {
  try {
    const warm = await navigator.mediaDevices.getUserMedia({ audio: true });
    warm.getTracks().forEach((track) => track.stop());
  } catch (error) {
    hud.noMic(error?.message || 'microphone unavailable');
    return;
  }

  const devices = await navigator.mediaDevices.enumerateDevices();
  const inputs = devices.filter((device) => device.kind === 'audioinput');
  const wanted = (hud.micLabel || '').trim().toLowerCase();

  if (wanted) {
    const match = inputs.find((device) => device.label.toLowerCase().includes(wanted));
    if (match) preferredDeviceId = match.deviceId;
  }

  // Reported before any complaint about a bad match: a wrong AVELYN_MIC is
  // precisely when the list is needed, so it must not be skipped then.
  hud.reportMics(inputs.map((device, index) => ({
    label: device.label || `(unnamed device ${index})`,
    // Chromium lists the system default first; there is no explicit flag.
    isDefault: index === 0,
    isSelected: preferredDeviceId ? device.deviceId === preferredDeviceId : index === 0,
  })));

  if (wanted && !preferredDeviceId) {
    // Falling back silently is the one outcome worth avoiding: she would
    // listen to the wrong device while the config looked correct.
    hud.noMic(`no mic matching "${hud.micLabel}" — pick one in Settings → Voice input`);
  }
}

function render(state) {
  el.hud.dataset.state = state;
  el.label.textContent = LABELS[state] ?? 'Avelyn';
}

function setLevel(value) {
  // Smoothed, or the dot flickers rather than breathing.
  level = level * 0.75 + value * 0.25;
  el.hud.style.setProperty('--level', level.toFixed(3));
}

function rms(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

/** Average groups of `ratio` samples. Ratio is an integer for 48k -> 16k. */
function downsample(input, from, to) {
  if (from === to) return input;
  const ratio = from / to;
  const length = Math.floor(input.length / ratio);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.floor((i + 1) * ratio);
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    out[i] = sum / Math.max(1, end - start);
  }
  return out;
}

function toInt16(input) {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const clamped = Math.max(-1, Math.min(1, input[i]));
    out[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  return out;
}

/**
 * Load the capture worklet ahead of time, on a context with no microphone
 * attached.
 *
 * This exists because the worklet is the one piece of the audio path that
 * cannot fail visibly on its own: when it fails, recording simply produces no
 * audio and looks identical to a dead microphone. Doing it at startup turns
 * that into an error on screen before anything is even plugged in.
 */
async function prepareAudio() {
  audioContext = new AudioContext();
  try {
    // Plain filename, not a blob: keeps it inside the page's script-src.
    await audioContext.audioWorklet.addModule('capture-worklet.js');
  } catch (error) {
    audioContext = null;
    throw new Error(`audio worklet failed to load: ${error?.message ?? error}`);
  }
}

async function startRecording() {
  let stream;
  try {
    if (!audioContext) await prepareAudio();

    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        ...(preferredDeviceId ? { deviceId: { exact: preferredDeviceId } } : {}),
      },
    });
  } catch (error) {
    // Everything from here on used to escape uncaught, so a failure looked
    // exactly like her ignoring you.
    hud.noMic(error?.message || 'microphone unavailable');
    return;
  }

  const source = audioContext.createMediaStreamSource(stream);
  const worklet = new AudioWorkletNode(audioContext, 'capture');

  // Per-recording buffer, captured by this handler alone. It used to be a
  // shared module-level array, and the worklet from every earlier turn kept
  // its own handler attached and still connected — so each past recording
  // went on appending to the current one. Turn five held five recordings'
  // audio, which is why recognition was convincing at first and then fell
  // apart: whisper was being handed repeated overlapping speech and answered
  // with repetition loops.
  const captured = [];
  // Always watching for the length cap; only listening for the end of a
  // sentence when "stop when I stop talking" is on.
  const detector = SilenceDetector.createSilenceDetector(
    hud.autoStop ? {} : { silenceMs: Infinity, noSpeechMs: Infinity },
  );
  const sampleRate = audioContext.sampleRate;
  const current = { source, worklet, captured, stream, startedAt: Date.now() };
  worklet.port.onmessage = ({ data }) => {
    captured.push(data);
    const level = rms(data);
    setLevel(Math.min(1, level * 6));
    const verdict = detector.push(level, (data.length / sampleRate) * 1000);
    if (verdict !== 'continue') endOnItsOwn(current, verdict);
  };

  source.connect(worklet);
  worklet.connect(audioContext.destination);

  session = current;
}

/**
 * The recording ended without a second tap. Main is told first, so the
 * hotkey's next press starts a new recording instead of "stopping" this one.
 * Nothing said at all is dropped here rather than sent to be transcribed:
 * six seconds of room tone is exactly what whisper hallucinates over.
 */
function endOnItsOwn(current, verdict) {
  if (session !== current) return;
  hud.autoStopped(verdict);
  stopRecording({ send: verdict !== 'nothing' })
    .catch((error) => hud.noMic(error?.message ?? String(error)));
}

/**
 * @param {{ send?: boolean }} [options] `send: false` measures a recording
 *   without handing it to the pipeline — used by the self-test so it can run
 *   several cycles without making her answer each one.
 * @returns the measurement, or null if there was nothing to keep.
 */
async function stopRecording({ send = true } = {}) {
  const current = session;
  session = null;
  if (!current) return null;

  const elapsed = Date.now() - current.startedAt;
  // Read before the context is closed. Deriving this from sample count over
  // elapsed time would fold in every millisecond spent not capturing, and a
  // wrong rate here stretches the audio and quietly degrades recognition.
  const nativeRate = audioContext?.sampleRate ?? TARGET_RATE;

  // Handler detached before teardown, so anything still in flight is dropped
  // rather than landing in a buffer nobody will read.
  current.worklet.port.onmessage = null;
  current.worklet.disconnect();
  // The source was previously left connected with only the worklet's output
  // severed, which is what kept stale nodes alive to begin with.
  current.source.disconnect();
  current.stream.getTracks().forEach((track) => track.stop());
  setLevel(0);

  const chunks = current.captured;
  if (elapsed < MIN_RECORDING_MS || chunks.length === 0) {
    render('idle');
    // Said out loud, so main can let go of the thinking pose it already
    // started: no audio means no turn, and no turn would ever settle it.
    if (send) hud.discarded();
    return null;
  }

  const frames = chunks.reduce((n, c) => n + c.length, 0);
  const merged = new Float32Array(frames);
  let at = 0;
  for (const chunk of chunks) { merged.set(chunk, at); at += chunk.length; }

  let peak = 0;
  let sum = 0;
  for (const sample of merged) {
    const magnitude = Math.abs(sample);
    if (magnitude > peak) peak = magnitude;
    sum += sample * sample;
  }
  const rms = merged.length ? Math.sqrt(sum / merged.length) : 0;

  // Gain applied before downsampling so the quantisation to 16-bit happens
  // around a full-scale signal rather than a near-silent one.
  const gain = peak >= SILENCE_FLOOR && peak < NORMALIZE_CEILING
    ? NORMALIZE_CEILING / peak
    : 1;
  if (gain !== 1) {
    for (let i = 0; i < merged.length; i++) merged[i] *= gain;
  }

  // Downsampled once at the end rather than per chunk: resampling each chunk
  // independently would put a small discontinuity at every boundary.
  const pcm = toInt16(downsample(merged, nativeRate, TARGET_RATE));

  const measured = {
    seconds: elapsed / 1000,
    // The number that exposes accumulation: it should track the wall-clock
    // duration of this recording and nothing else.
    audioSeconds: pcm.length / TARGET_RATE,
    peak,
    rms,
    gain,
  };
  if (send) hud.sendPcm(pcm.buffer, TARGET_RATE, measured);
  return measured;
}

hud.onState((state) => {
  render(state.state);
  if (state.state === 'thinking') {
    el.text.textContent = state.transcript ?? '';
  } else if (state.state === 'reply') {
    el.text.textContent = state.text ?? '';
  } else if (state.state === 'error') {
    el.text.textContent = state.message ?? '';
  } else if (state.state === 'idle') {
    el.text.textContent = state.note ?? '';
  } else {
    el.text.textContent = '';
  }
  fitToText();
});

// Window chrome around the text column: .hud's vertical padding and border.
const HUD_CHROME = 34;

/**
 * Ask main for a window tall enough for the text. Replies used to be clipped
 * at two lines with an ellipsis, cutting off most of anything she said; past
 * main's cap the text scrolls instead.
 */
function fitToText() {
  requestAnimationFrame(() => {
    // The text's full height, not its box: the box is capped to the current
    // window, so measuring it could never ask for more room.
    const text = el.body.scrollHeight - el.text.clientHeight + el.text.scrollHeight;
    hud.resize(Math.ceil(text + HUD_CHROME));
    el.text.scrollTop = 0;
    markScrolling();
  });
}

/** See `.text.scrolls` in index.html: only text that scrolls stops the bubble being dragged. */
function markScrolling() {
  el.text.classList.toggle('scrolls', el.text.scrollHeight > el.text.clientHeight + 1);
}

// main resizes the window after fitToText asks; whether the text still
// overflows is only known once it has.
window.addEventListener('resize', markScrolling);

hud.onBrain((brain) => {
  el.model.textContent = brain?.label ?? '';
});

/**
 * Open the configured microphone for a few seconds and report what actually
 * reached it.
 *
 * Deliberately runs through the same worklet the real capture uses: a check
 * that took a different path could pass while the path that matters is
 * broken, which is the whole failure being investigated.
 */
async function runMicTest() {
  try {
    if (!audioContext) await prepareAudio();

    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs = devices.filter((device) => device.kind === 'audioinput');
    const wanted = (hud.micLabel || '').trim().toLowerCase();
    const match = wanted
      ? inputs.find((device) => device.label.toLowerCase().includes(wanted))
      : null;
    if (wanted && !match) throw new Error(`no mic matching "${hud.micLabel}"`);

    const opened = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        ...(match ? { deviceId: { exact: match.deviceId } } : {}),
      },
    });
    const label = opened.getAudioTracks()[0]?.label || '(unnamed)';

    const source = audioContext.createMediaStreamSource(opened);
    const probe = new AudioWorkletNode(audioContext, 'capture');
    let peak = 0;
    let sum = 0;
    let count = 0;
    let chunks = 0;
    probe.port.onmessage = ({ data }) => {
      chunks += 1;
      for (const sample of data) {
        const magnitude = Math.abs(sample);
        if (magnitude > peak) peak = magnitude;
        sum += sample * sample;
        count += 1;
      }
    };

    source.connect(probe);
    probe.connect(audioContext.destination);
    await new Promise((resolve) => setTimeout(resolve, 3000));
    probe.disconnect();
    source.disconnect();
    opened.getTracks().forEach((track) => track.stop());

    hud.reportMicTest({
      ok: true,
      label,
      sampleRate: audioContext.sampleRate,
      chunks,
      peak,
      rms: count ? Math.sqrt(sum / count) : 0,
    });
  } catch (error) {
    hud.reportMicTest({ ok: false, error: error?.message ?? String(error) });
  }
}

/**
 * Record and stop several times in a row, reporting the length of each.
 *
 * A regression test for a bug that was invisible one turn at a time: the
 * audio sent for turn N included every earlier turn as well, so the first
 * thing you said transcribed fine and everything after it got worse. If
 * `audioSeconds` stays level with `seconds` across cycles, recordings are
 * independent again; if it climbs 1x, 2x, 3x, they are not.
 */
async function runCaptureTest() {
  const cycles = [];
  try {
    if (!audioContext) await prepareAudio();

    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs = devices.filter((device) => device.kind === 'audioinput');
    const wanted = (hud.micLabel || '').trim().toLowerCase();
    const match = wanted
      ? inputs.find((device) => device.label.toLowerCase().includes(wanted))
      : null;
    if (wanted && !match) throw new Error(`no mic matching "${hud.micLabel}"`);
    preferredDeviceId = match?.deviceId ?? null;

    for (let index = 0; index < 4; index += 1) {
      await startRecording();
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const measured = await stopRecording({ send: false });
      if (!measured) throw new Error('a cycle captured nothing');
      cycles.push(measured);
    }

    // The matched device, not inputs[0]: reporting the default here would
    // name a microphone this test never touched.
    hud.reportCaptureTest({
      ok: true,
      label: match?.label ?? inputs[0]?.label ?? '',
      cycles,
    });
  } catch (error) {
    hud.reportCaptureTest({ ok: false, error: error?.message ?? String(error), cycles });
  }
}

if (hud.captureTest) {
  runCaptureTest();
} else if (hud.micTest) {
  runMicTest();
}

// Every entry point catches: an unhandled rejection here is invisible, and
// invisible is indistinguishable from her ignoring you.
hud.onStartRecording(() => {
  startRecording().catch((error) => hud.noMic(error?.message ?? String(error)));
});
hud.onStopRecording(() => {
  stopRecording().catch((error) => hud.noMic(error?.message ?? String(error)));
});

// Verified before anything is asked of it, so a broken audio path shows up as
// an error immediately rather than as silence when you first speak.
prepareAudio()
  .catch((error) => hud.noMic(error?.message ?? String(error)))
  .finally(() => initMicrophone());
