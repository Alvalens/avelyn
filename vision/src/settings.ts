import { readFile } from 'node:fs/promises';
import { readRuntime, runtimePath } from '../../bridge/src/runtime.ts';

export interface VisionSettings {
  /** Master switch for `look` and the screenshot folder. */
  enabled: boolean;
  /** She may speak without being spoken to. */
  initiative: boolean;
  /** Her unprompted turns may capture the screen. */
  lookOnItsOwn: boolean;
  /** Random gap between unprompted remarks, [min, max] minutes. */
  minGapMinutes: [number, number];
  /** How long since the user last talked to her counts as "quiet for a while". */
  quietMinutes: number;
  /** Cooldown after she chooses `[quiet]` or a nudge fails. */
  retryGapMinutes: number;
  /** Screenshots kept on disk. */
  keep: number;
  /** Process names / title fragments that are never captured. */
  blocklist: string[];
}

/**
 * Substring matches, case-insensitive, against the process name and window
 * title. Deliberately broad: over-blocking only costs her a glance.
 */
export const DEFAULT_BLOCKLIST = [
  'keepass', '1password', 'bitwarden', 'lastpass', 'dashlane', 'nordpass',
  'private browsing', 'incognito', 'inprivate',
  'bank', 'paypal',
];

export const DEFAULT_SETTINGS: VisionSettings = {
  enabled: true,
  initiative: true,
  lookOnItsOwn: true,
  minGapMinutes: [20, 40],
  quietMinutes: 15,
  retryGapMinutes: 10,
  keep: 50,
  blocklist: DEFAULT_BLOCKLIST,
};

function positive(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Never throws: a hand-edited file must not take her eyes away. */
export function normalizeSettings(raw: unknown): VisionSettings {
  const data = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};

  const gap = Array.isArray(data.minGapMinutes) ? data.minGapMinutes : [];
  const a = positive(gap[0], DEFAULT_SETTINGS.minGapMinutes[0]);
  const b = positive(gap[1], DEFAULT_SETTINGS.minGapMinutes[1]);

  const keep = Math.floor(positive(data.keep, DEFAULT_SETTINGS.keep));

  return {
    enabled: data.enabled !== false,
    initiative: data.initiative !== false,
    lookOnItsOwn: data.lookOnItsOwn !== false,
    minGapMinutes: a <= b ? [a, b] : [b, a],
    quietMinutes: positive(data.quietMinutes, DEFAULT_SETTINGS.quietMinutes),
    retryGapMinutes: positive(data.retryGapMinutes, DEFAULT_SETTINGS.retryGapMinutes),
    keep: keep >= 1 ? keep : DEFAULT_SETTINGS.keep,
    blocklist: Array.isArray(data.blocklist)
      ? data.blocklist
          .filter((entry): entry is string => typeof entry === 'string')
          .map((entry) => entry.trim())
          .filter(Boolean)
      : DEFAULT_SETTINGS.blocklist,
  };
}

/**
 * The `vision` section the app publishes in its runtime file (bridge/src/runtime.ts).
 * Read on every use: the app rewrites it when a toggle flips, and the engine
 * and pipeline outlive that. Anything unreadable means the defaults.
 */
export async function loadSettings(path: string = runtimePath()): Promise<VisionSettings> {
  try {
    const { vision } = readRuntime(path);
    return vision === undefined ? DEFAULT_SETTINGS : normalizeSettings(vision);
  } catch {
    return DEFAULT_SETTINGS;
  }
}
