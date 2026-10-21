import { loadConfigFromEnv, listSpeakers, type Emotion } from './voicevoxClient.ts';
import { say } from './say.ts';

const [, , command, ...args] = process.argv;

const EMOTIONS: Emotion[] = ['happy', 'angry', 'sad', 'relaxed', 'surprised'];

function usage(): never {
  console.log(`Usage:
  speakers                              list available speaker/style ids from the running VOICEVOX engine
  say <text> [speakerId] [emotion]      speak text out loud (speakerId defaults to VOICEVOX_SPEAKER_ID from .env;
                                         emotion is one of ${EMOTIONS.join('/')}, defaults to neutral)`);
  process.exit(1);
}

async function main() {
  if (!command) usage();

  const config = loadConfigFromEnv();

  switch (command) {
    case 'speakers': {
      const speakers = await listSpeakers(config);
      console.log(JSON.stringify(speakers, null, 2));
      break;
    }
    case 'say': {
      const [text, speakerId, emotion] = args;
      if (!text) usage();
      if (emotion && !EMOTIONS.includes(emotion as Emotion)) usage();
      await say(config, text, speakerId ? Number(speakerId) : undefined, {
        emotion: emotion as Emotion | undefined,
      });
      console.log('Done.');
      break;
    }
    default:
      usage();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
