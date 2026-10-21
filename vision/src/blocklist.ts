export interface ForegroundWindow {
  process: string;
  title: string;
}

/**
 * The blocklist entry that matches the window in front, or null. Process and
 * title are checked separately so an entry cannot match across their join.
 */
export function blockedBy(window: ForegroundWindow, blocklist: string[]): string | null {
  const process = window.process.replace(/\.exe$/i, '').toLowerCase();
  const title = window.title.toLowerCase();

  for (const entry of blocklist) {
    // ProcessName never carries .exe, so an entry written with one would
    // otherwise silently never match.
    const needle = entry.trim().toLowerCase().replace(/\.exe$/, '');
    // An empty needle would match every window.
    if (needle && (process.includes(needle) || title.includes(needle))) return entry;
  }
  return null;
}
