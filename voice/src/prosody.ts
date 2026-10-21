// A superset of bridge/src/actions.ts's ExpressionId vocabulary. The five
// shared words are deliberate — the same word an expression.set call already
// uses can also drive her voice, so a caller doesn't need a second vocabulary
// just for prosody. `shy` is the exception, and the reason the sets differ:
// VRM's face presets are a fixed set with no shy, so an action whose face
// borrows `surprised` still needs a *voice* that reads as flustered rather
// than startled. See PersonalityAction.voiceEmotion.
export type Emotion = 'happy' | 'angry' | 'sad' | 'relaxed' | 'surprised' | 'shy';

interface ProsodyScale {
  speedScale: number;
  pitchScale: number;
  intonationScale: number;
  volumeScale: number;
  /** Dead air between accent phrases. 1 = VOICEVOX's own spacing. */
  pauseLengthScale: number;
}

// VOICEVOX's own audio_query baseline — what every field already is before
// anything here touches it. Used as the "from" end of the lerp when a query
// doesn't carry its own value for a field yet.
const NEUTRAL: ProsodyScale = {
  speedScale: 1,
  pitchScale: 0,
  intonationScale: 1,
  volumeScale: 1,
  pauseLengthScale: 1,
};

// Applied to *every* line, before any emotion. Most turns carry no emotion at
// all — persona/AGENTS.md actively invites omitting it for an ordinary reply — and
// those used to reach VOICEVOX with every scale still at its raw default.
// That is the flat read the user heard: not a wrong emotion target, just no
// shaping whatsoever on the majority of lines.
//
// Deliberately gentle. It stacks *under* EMOTION_TARGETS rather than
// replacing them, so it must not eat the headroom a real emotion needs.
// Intonation carries most of the lift — that is the axis that reads as
// "animated" — and loudness is left alone, since the complaint was flatness,
// not volume.
export const BASELINE: ProsodyScale = {
  speedScale: 1.06,
  pitchScale: 0.02,
  intonationScale: 1.15,
  volumeScale: 1,
  pauseLengthScale: 0.9,
};

// Hand-tuned relative to NEUTRAL, not absolute values pulled from nowhere —
// nudges in the direction VOICEVOX/VTuber tuning guides converge on for each
// mood (faster+brighter+more varied pitch for happy, slower+flatter+quieter
// for sad, sharper intonation for angry, and so on).
//
// Tuned by ear against a listening pass, which taught three things worth
// keeping. (1) `pitchScale` shifts the *whole voice* up, so past roughly 0.06
// it stops reading as "bright" and starts reading as chipmunk — artificial.
// (2) Raw `speedScale` on a high-arousal mood quickly reads as rushed rather
// than energetic. So intonation carries the high-energy moods instead: it is
// relative pitch *variation* across the line, which is what actually reads as
// animated, without the whole-voice shift or the rush. (3) Pauses do NOT move
// uniformly with energy — surprised and angry are both high-energy but want
// opposite handling, because tightened pauses made surprised's ending tumble
// out while they are what make angry feel pressing. Don't derive one from the
// other. sad and relaxed keep their original values; the same pass found those
// already landing right.
const EMOTION_TARGETS: Record<Emotion, ProsodyScale> = {
  happy: { speedScale: 1.08, pitchScale: 0.05, intonationScale: 1.35, volumeScale: 1.03, pauseLengthScale: 0.88 },
  sad: { speedScale: 0.9, pitchScale: -0.04, intonationScale: 0.78, volumeScale: 0.88, pauseLengthScale: 1.15 },
  angry: { speedScale: 1.05, pitchScale: 0.02, intonationScale: 1.6, volumeScale: 1.1, pauseLengthScale: 0.95 },
  relaxed: { speedScale: 0.96, pitchScale: -0.01, intonationScale: 0.98, volumeScale: 1, pauseLengthScale: 1.05 },
  surprised: { speedScale: 1.1, pitchScale: 0.05, intonationScale: 1.45, volumeScale: 1.05, pauseLengthScale: 1.2 },
  // Voice-only. Deliberately NOT a scaled-down surprised: narrower swings,
  // quieter, slightly slower, longer pauses. The two are near-opposite shapes,
  // which is exactly why borrowing surprised's target never read as shy.
  shy: { speedScale: 1.0, pitchScale: 0.04, intonationScale: 1.15, volumeScale: 0.9, pauseLengthScale: 1.15 },
};

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

function scaleField(query: Record<string, unknown>, key: keyof ProsodyScale): number {
  const raw = query[key];
  return typeof raw === 'number' ? raw : NEUTRAL[key];
}

/**
 * Snaps a query onto BASELINE, whatever it carried before. Meant to run on
 * every line, emotion or not, so an ordinary reply is still shaped rather than
 * left at VOICEVOX's flat defaults.
 */
export function applyBaseline(query: Record<string, unknown>): Record<string, unknown> {
  return {
    ...query,
    speedScale: BASELINE.speedScale,
    pitchScale: BASELINE.pitchScale,
    intonationScale: BASELINE.intonationScale,
    volumeScale: BASELINE.volumeScale,
    pauseLengthScale: BASELINE.pauseLengthScale,
  };
}

/**
 * Nudges a VOICEVOX audio_query's prosody fields toward an emotion, scaled by
 * intensity (0 = untouched, 1 = the full hand-tuned target) — mirrors the
 * `weight` bridge/src/actions.ts already uses for expression.set, so a mild
 * emotion sounds mild instead of every line maxing out the same way.
 *
 * Lerps from whatever the query already carries, which is what lets this
 * compose with applyBaseline: callers run the baseline first, so a
 * full-intensity emotion still lands exactly on its target, while a partial
 * one sits between the baseline and the target rather than between VOICEVOX's
 * default and the target.
 *
 * @param query An audio_query response (or another query already run through this).
 * @param intensity Clamped to [0, 1]; defaults to 1 (the full target).
 */
export function applyEmotion(
  query: Record<string, unknown>,
  emotion: Emotion,
  intensity = 1,
): Record<string, unknown> {
  const target = EMOTION_TARGETS[emotion];
  const t = Math.min(1, Math.max(0, intensity));
  return {
    ...query,
    speedScale: lerp(scaleField(query, 'speedScale'), target.speedScale, t),
    pitchScale: lerp(scaleField(query, 'pitchScale'), target.pitchScale, t),
    intonationScale: lerp(scaleField(query, 'intonationScale'), target.intonationScale, t),
    volumeScale: lerp(scaleField(query, 'volumeScale'), target.volumeScale, t),
    pauseLengthScale: lerp(scaleField(query, 'pauseLengthScale'), target.pauseLengthScale, t),
  };
}

/**
 * A flat lift on top of everything above. Measured on this machine, a plain
 * line peaks near 38% of full scale (about -28 dBFS average), which reads as
 * quiet next to ordinary speech. It is a separate final step, not part of
 * BASELINE, so the mood targets keep their meaning — sad and shy stay quieter
 * than a plain line — and the whole voice just sits higher.
 */
export const MASTER_VOLUME = 1.3;

/** Past this a loud line's peaks start to clip. */
const MAX_VOLUME_SCALE = 1.6;

export function applyMasterVolume(query: Record<string, unknown>): Record<string, unknown> {
  return {
    ...query,
    volumeScale: Math.min(MAX_VOLUME_SCALE, scaleField(query, 'volumeScale') * MASTER_VOLUME),
  };
}
