import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * A marker held while an unprompted turn runs with "look on her own" switched
 * off. `look` runs in a different process (the engine, under agy) from the
 * pipeline that knows the setting, and the prompt alone — "you can't look" —
 * is only a request to a model that has its permission checks off.
 *
 * It holds a timestamp and expires, so a pipeline that dies mid-nudge cannot
 * leave her unable to look for good.
 */
const STALE_MS = 5 * 60_000;

export async function holdNoLook(path: string, on: boolean, now: number = Date.now()): Promise<void> {
  if (on) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, String(now));
  } else {
    await rm(path, { force: true });
  }
}

/** Missing, unreadable or garbage markers all mean "allowed". */
export async function isNoLook(path: string, now: number = Date.now()): Promise<boolean> {
  try {
    const since = Number((await readFile(path, 'utf8')).trim());
    return Number.isFinite(since) && now - since < STALE_MS;
  } catch {
    return false;
  }
}
