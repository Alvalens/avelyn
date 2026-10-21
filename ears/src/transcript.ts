/**
 * whisper-cli writes the transcript to stdout and everything else — model
 * info, progress, `whisper_print_timings:` — to stderr. So stdout is already
 * clean text; with `-nt` it is a leading blank line followed by one line per
 * segment, each prefixed with a single space.
 */
export function parseTranscript(stdout: string): string {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(' ');
}

/**
 * Whole-utterance hallucinations whisper emits when it is handed audio with
 * no speech in it. `you` was observed directly on this machine — 4 seconds of
 * digital silence transcribes to " You" with `ggml-base.en`. The rest are the
 * long-documented member of the same family, not independently reproduced
 * here; treat this list as a starting point to extend from real captures
 * rather than a finished set.
 */
const SILENCE_HALLUCINATIONS = new Set([
  'you',
  'thank you',
  'thanks for watching',
  'thank you for watching',
  'blank_audio',
  'silence',
  'music',
  'bye',
  'please subscribe',
]);

/**
 * Normalize away the wrapping that varies between artifacts — case, and the
 * brackets or trailing period whisper puts around non-speech markers — so
 * `[BLANK_AUDIO]`, `(silence)` and `Thank you.` all reduce to bare words.
 */
function normalize(text: string): string {
  return text.toLowerCase().trim().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
}

/**
 * Raw peak (0..1, before the HUD's gain) at or above which a recording has
 * real signal in it. Room tone on a working mic sits well below; speech well
 * above. A first value — tune against real captures if it misfires.
 */
export const SPEECH_PEAK = 0.02;

/**
 * Whether a transcript is really whisper hallucinating into silence.
 *
 * Matches the **whole** transcript only, never a substring — "You" is a word
 * a person genuinely says, and a substring match would throw away "I think
 * you should check it" along with the artifact it was aimed at.
 *
 * `inputPeak` is the recording's raw peak. "Thank you." and "Bye." are both
 * whisper's silence artifacts *and* exactly what people say to her, so when
 * the recording demonstrably had signal in it, they are taken as speech.
 * Without a level the list keeps its blunt meaning.
 */
export function looksLikeSilence(transcript: string, inputPeak?: number): boolean {
  const normalized = normalize(transcript);
  if (normalized === '') return true;
  if (!SILENCE_HALLUCINATIONS.has(normalized)) return false;
  return inputPeak === undefined || inputPeak < SPEECH_PEAK;
}

/**
 * What whisper hears → what was said. `ggml-base.en` has never seen her name
 * and writes "Evelyn"; a decoder prompt fixed that but made it skip a spoken
 * "Hi Avelyn." outright (prompt text reads as already said). Extend this as
 * real mishearings show up.
 */
export const DEFAULT_CORRECTIONS: Record<string, string> = {
  Evelyn: 'Avelyn',
};

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whole-word, case-insensitive replacement of known mishearings. */
export function correctTranscript(
  text: string,
  corrections: Record<string, string> = DEFAULT_CORRECTIONS,
): string {
  let out = text;
  for (const [heard, meant] of Object.entries(corrections)) {
    out = out.replace(new RegExp(`\\b${escapeRegExp(heard)}\\b`, 'gi'), meant);
  }
  return out;
}
