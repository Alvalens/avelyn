import { applyBaseline, applyEmotion, applyMasterVolume, type Emotion } from './prosody.ts';

export type { Emotion } from './prosody.ts';

export interface VoicevoxConfig {
  baseUrl: string;
  speakerId: number;
}

export interface SpeakOptions {
  emotion?: Emotion;
  /** 0-1, defaults to 1 (the full emotion target). Ignored without `emotion`. */
  intensity?: number;
}

// VOICEVOX pads ~0.1s of silence before the first phoneme by default. That
// exists to give downstream playback pipelines room to start cleanly, but
// this app's own pipeline (temp-file write, bus round trip, renderer decode)
// already provides that room — the full default pad is dead air on top of
// it. Trimmed, not zeroed: some margin is kept so a slow playback start still
// can't clip the first syllable.
const PRE_PHONEME_LENGTH = 0.05;

// Read lazily inside speak(), not hoisted into a module-level constant: an MCP
// host (engine/src/server.ts) calls process.loadEnvFile() *after* its imports
// already ran, so a top-level read here would always see the value from
// before .env was loaded — only real shell env vars would ever be noticed.
function debugTimingEnabled(): boolean {
  return process.env.VOICEVOX_DEBUG_TIMING === '1';
}

export interface SpeakerStyle {
  name: string;
  id: number;
}

export interface Speaker {
  name: string;
  speakerUuid: string;
  styles: SpeakerStyle[];
}

export function loadConfigFromEnv(): VoicevoxConfig {
  const baseUrl = process.env.VOICEVOX_URL ?? 'http://127.0.0.1:50021';
  const speakerId = Number(process.env.VOICEVOX_SPEAKER_ID ?? 14); // 冥鳴ひまり — calm, mature tone matching Avelyn's persona
  return { baseUrl, speakerId };
}

async function assertOk(response: Response, action: string): Promise<void> {
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`VOICEVOX ${action} failed: HTTP ${response.status} ${body}`.trim());
  }
}

// The engine (a separate local app, not an npm dependency) must already be running —
// there is no bundled fallback if it isn't.
export async function listSpeakers(config: VoicevoxConfig): Promise<Speaker[]> {
  const response = await fetch(`${config.baseUrl}/speakers`);
  await assertOk(response, 'listSpeakers');
  const body = (await response.json()) as Array<{
    name: string;
    speaker_uuid: string;
    styles: Array<{ name: string; id: number }>;
  }>;
  return body.map((speaker) => ({
    name: speaker.name,
    speakerUuid: speaker.speaker_uuid,
    styles: speaker.styles.map((style) => ({ name: style.name, id: style.id })),
  }));
}

export async function audioQuery(
  config: VoicevoxConfig,
  text: string,
  speakerId: number = config.speakerId,
): Promise<Record<string, unknown>> {
  const params = new URLSearchParams({ text, speaker: String(speakerId) });
  const response = await fetch(`${config.baseUrl}/audio_query?${params}`, { method: 'POST' });
  await assertOk(response, 'audioQuery');
  return response.json() as Promise<Record<string, unknown>>;
}

export async function synthesize(
  config: VoicevoxConfig,
  query: Record<string, unknown>,
  speakerId: number = config.speakerId,
): Promise<Buffer> {
  const params = new URLSearchParams({ speaker: String(speakerId) });
  const response = await fetch(`${config.baseUrl}/synthesis?${params}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(query),
  });
  await assertOk(response, 'synthesize');
  return Buffer.from(await response.arrayBuffer());
}

// Combines the query + synthesis round trip VOICEVOX always requires — a single
// call always needs both steps, there's no one-shot "speak" endpoint on the engine.
export async function speak(
  config: VoicevoxConfig,
  text: string,
  speakerId: number = config.speakerId,
  options?: SpeakOptions,
): Promise<Buffer> {
  const t0 = Date.now();
  let query = await audioQuery(config, text, speakerId);
  const t1 = Date.now();

  query = { ...query, prePhonemeLength: PRE_PHONEME_LENGTH };
  // Always, not only when an emotion is given: most lines carry no emotion,
  // and leaving those at VOICEVOX's raw defaults is what made ordinary
  // conversation read flat. The emotion target then stacks on top of it.
  query = applyBaseline(query);
  if (options?.emotion) {
    query = applyEmotion(query, options.emotion, options.intensity);
  }
  // Last, so it lifts every line equally and the mood above still reads.
  query = applyMasterVolume(query);

  const wav = await synthesize(config, query, speakerId);
  const t2 = Date.now();

  if (debugTimingEnabled()) {
    console.error(`[voice] audioQuery ${t1 - t0}ms, synthesize ${t2 - t1}ms, total ${t2 - t0}ms`);
  }

  return wav;
}
