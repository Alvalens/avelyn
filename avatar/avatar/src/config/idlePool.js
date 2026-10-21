/**
 * The idle pool: animations the user marked (right-click in the Animations
 * menu) as somewhere the avatar can rest. When a one-shot finishes — a bridge
 * gesture, or a Combo picked from the menu — the stage returns to one of these
 * rather than holding the gesture's last pose indefinitely.
 *
 * An empty pool is deliberately the old behaviour: with nothing to return to,
 * whatever is selected simply keeps playing.
 *
 * Ids are stored as given and never checked against a catalog. A custom
 * animations folder hashes its ids from file paths, so a pool saved against
 * one folder is meaningless against another — but dropping unknown ids on read
 * would quietly empty the pool during the window before the folder scan
 * finishes. `pickIdleAnimation`'s caller resolves against the live catalog
 * instead, the same way motion-deck cards do.
 */

export const maxIdlePoolSize = 32;

/** @returns {string[]} */
export function createDefaultIdlePool() {
  return [];
}

/**
 * @param {unknown} raw
 * @returns {string[]}
 */
export function normalizeIdlePool(raw) {
  if (!Array.isArray(raw)) return [];

  const seen = new Set();
  const pool = [];
  for (const value of raw) {
    if (typeof value !== 'string') continue;
    const id = value.trim();
    if (id === '' || seen.has(id)) continue;
    seen.add(id);
    pool.push(id);
    if (pool.length >= maxIdlePoolSize) break;
  }
  return pool;
}

/**
 * @param {string[]} pool
 * @param {string} id
 */
export function isIdleAnimation(pool, id) {
  return Array.isArray(pool) && pool.includes(id);
}

/**
 * @param {string[]} pool
 * @param {string} id
 * @returns {string[]} a new pool — never the one passed in
 */
export function toggleIdlePool(pool, id) {
  const current = normalizeIdlePool(pool);
  if (typeof id !== 'string' || id.trim() === '') return current;

  const trimmed = id.trim();
  return current.includes(trimmed)
    ? current.filter((entry) => entry !== trimmed)
    : normalizeIdlePool([...current, trimmed]);
}

/**
 * Pick where to rest. Never answers with `currentId` while there is anything
 * else to choose, so the same idle cannot come up twice running. A one-entry
 * pool is the exception — the user asked for exactly one resting animation, so
 * it replays.
 *
 * @param {string[]} pool
 * @param {string | null} currentId
 * @param {() => number} [random]
 * @returns {string | null} null when the pool is empty
 */
export function pickIdleAnimation(pool, currentId, random = Math.random) {
  const candidates = normalizeIdlePool(pool);
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  const others = candidates.filter((entry) => entry !== currentId);
  const from = others.length > 0 ? others : candidates;
  // Clamped: a random() of exactly 1 would otherwise index off the end.
  const index = Math.min(from.length - 1, Math.floor(random() * from.length));
  return from[index];
}
