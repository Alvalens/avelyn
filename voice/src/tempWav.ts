import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface TempWavFile {
  path: string;
  cleanup(): Promise<void>;
}

export async function writeTempWav(wav: Buffer): Promise<TempWavFile> {
  const dir = await mkdtemp(join(tmpdir(), 'avelyn-voice-'));
  const path = join(dir, 'speech.wav');
  await writeFile(path, wav);
  return { path, cleanup: () => rm(dir, { recursive: true, force: true }) };
}
