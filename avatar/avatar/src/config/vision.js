/**
 * Her eyes and her initiative (the `vision` section of config.yaml), free of
 * asset imports so `node --test` can load it.
 *
 * Only the three toggles have defaults here. The timings, `keep` and the
 * blocklist are hand-edited knobs whose defaults and validation live in
 * vision/src/settings.ts — the one place the Node 24 side reads them — so they
 * are carried through untouched rather than duplicated. Duplicating them would
 * mean a save from Settings could quietly reset a blocklist the user wrote.
 */

const PASSTHROUGH = ['minGapMinutes', 'quietMinutes', 'retryGapMinutes', 'keep', 'blocklist'];

/** @typedef {{ enabled: boolean, initiative: boolean, lookOnItsOwn: boolean }} VisionSettings */

/** @returns {VisionSettings} */
export function createDefaultVision() {
  return { enabled: true, initiative: true, lookOnItsOwn: true };
}

/**
 * @param {unknown} raw
 * @returns {VisionSettings & Record<string, unknown>}
 */
export function normalizeVision(raw) {
  const defaults = createDefaultVision();
  if (!raw || typeof raw !== 'object') return defaults;

  const data = /** @type {Record<string, unknown>} */ (raw);
  /** @type {Record<string, unknown>} */
  const out = {
    // On by default; only a real `false` turns each off.
    enabled: data.enabled !== false,
    initiative: data.initiative !== false,
    lookOnItsOwn: data.lookOnItsOwn !== false,
  };
  for (const key of PASSTHROUGH) {
    if (data[key] !== undefined) out[key] = data[key];
  }
  return /** @type {VisionSettings & Record<string, unknown>} */ (out);
}
