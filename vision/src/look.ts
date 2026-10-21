import { rm } from 'node:fs/promises';
import { blockedBy, type ForegroundWindow } from './blocklist.ts';
import { capture } from './capture.ts';
import { foreground as realForeground } from './foreground.ts';
import { CAPTURES_DIR } from './paths.ts';
import type { VisionSettings } from './settings.ts';

export type LookResult =
  | { ok: true; path: string }
  | { ok: false; reason: 'disabled' | 'blocked' | 'failed'; message: string };

export interface LookOptions {
  settings: VisionSettings;
  dir?: string;
  foreground?: () => Promise<ForegroundWindow | null>;
  grab?: (path: string) => Promise<void>;
  now?: () => Date;
  /** An unprompted turn that is not allowed to look (see nolook.ts). */
  noLook?: boolean;
}

/**
 * Take one screenshot unless something says not to. The order matters: the
 * switch, then the foreground window against the blocklist, and only then the
 * capture — a blocked window is never captured and then deleted.
 *
 * If the foreground window cannot be determined the blocklist cannot be
 * checked, so this refuses rather than capture blind.
 */
export async function look(options: LookOptions): Promise<LookResult> {
  const { settings, dir = CAPTURES_DIR, foreground = realForeground, grab, now, noLook } = options;

  if (!settings.enabled) {
    return { ok: false, reason: 'disabled', message: 'Looking is switched off in her settings.' };
  }
  if (noLook) {
    return { ok: false, reason: 'disabled', message: "Not looking: she isn't set to look on her own." };
  }

  let window: ForegroundWindow | null = null;
  try {
    window = await foreground();
  } catch {
    window = null;
  }
  if (!window) {
    return {
      ok: false,
      reason: 'failed',
      message: "Couldn't tell which window is in front, so I'm not capturing the screen.",
    };
  }

  if (blockedBy(window, settings.blocklist)) {
    // Deliberately says nothing about which window or why it matched.
    return { ok: false, reason: 'blocked', message: 'Not looking: the window in front is on the blocklist.' };
  }

  let path: string;
  try {
    path = await capture({ dir, keep: settings.keep, now, grab });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: 'failed', message: `The screen capture failed: ${reason}` };
  }

  // The grab is a second PowerShell spawn, a second or so after the check
  // above, and the user can switch windows in between. Look again: if what is
  // in front now is blocked (or unknowable), the shot is deleted unseen.
  let after: ForegroundWindow | null = null;
  try {
    after = await foreground();
  } catch {
    after = null;
  }
  if (!after) {
    await rm(path, { force: true });
    return {
      ok: false,
      reason: 'failed',
      message: "Couldn't tell which window is in front, so I'm not capturing the screen.",
    };
  }
  if (blockedBy(after, settings.blocklist)) {
    await rm(path, { force: true });
    return { ok: false, reason: 'blocked', message: 'Not looking: the window in front is on the blocklist.' };
  }
  return { ok: true, path };
}
