import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeTempWav } from './tempWav.ts';

const execFileAsync = promisify(execFile);

// No audio-playback npm package needed — PowerShell's Media.SoundPlayer is always
// present on Windows (this project is Windows-only by design) and plays synchronously,
// so the temp file can be cleaned up the moment playback finishes. Local-only fallback:
// when AVATAR is running, engine/'s speak() routes through it instead (see
// engine/src/tools.ts and voice/README.md) so lip sync only reacts to her own voice.
export async function playWav(wav: Buffer): Promise<void> {
  const { path, cleanup } = await writeTempWav(wav);
  try {
    await execFileAsync('powershell', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `(New-Object Media.SoundPlayer '${path}').PlaySync()`,
    ]);
  } finally {
    await cleanup();
  }
}
