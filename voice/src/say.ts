import { speak, type SpeakOptions, type VoicevoxConfig } from './voicevoxClient.ts';
import { playWav } from './playAudio.ts';

export async function say(
  config: VoicevoxConfig,
  text: string,
  speakerId?: number,
  options?: SpeakOptions,
): Promise<void> {
  const wav = await speak(config, text, speakerId, options);
  await playWav(wav);
}
