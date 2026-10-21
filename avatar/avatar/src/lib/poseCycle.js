// Pure math for the pose-cycle idle: a shuffled walk through a curated pool
// of static poses, holding each for a jittered duration before crossfading
// to the next. Kept free of THREE/VRM imports so `node --test` can load it.

/**
 * Fisher-Yates. Returns a new array — never mutates `items`.
 * @template T
 * @param {T[]} items
 * @param {() => number} random - injectable for tests; defaults to Math.random.
 * @returns {T[]}
 */
export function shuffle(items, random = Math.random) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * +/-30% around the base, so a fixed hold duration doesn't feel metronomic.
 * @param {number} baseSeconds
 * @param {() => number} random
 */
export function jitterHoldSeconds(baseSeconds, random = Math.random) {
  return baseSeconds * (0.7 + random() * 0.6);
}
