/**
 * Decides when a push-to-talk recording is over without a second tap.
 *
 * Fed one level (RMS, 0..1) per capture chunk. "Speech" is relative to the
 * room rather than a fixed number: a fixed threshold that suits a quiet room
 * hears a fan as someone talking forever, and one that suits the fan misses
 * a quiet voice. The noise floor drops at once to anything quieter and only
 * creeps up while nobody is speaking, so a long sentence cannot raise it.
 *
 * A classic script (the page's CSP allows no modules), so it publishes a
 * global; electron/silence-detector.test.cjs evaluates it the same way.
 */
(function publish(root) {
  const DEFAULTS = {
    // A pause this long after speech is the end of what you were saying.
    // Shorter cuts people off mid-thought; a breath between clauses is ~0.5s.
    silenceMs: 1200,
    // Opened and never spoke into: give up rather than hold the mic open.
    noSpeechMs: 6000,
    // Hard cap, so a forgotten open mic cannot record forever.
    maxMs: 30000,
    // Speech must be this many times the room's level...
    ratio: 3,
    // ...and never below this, or near-digital-silence would make any breath speech.
    minLevel: 0.006,
    // Consecutive loud chunks needed to count as speech (~170 ms): the key
    // click of the hotkey itself is one loud chunk.
    speechChunks: 2,
    // How fast the floor follows a louder room, per chunk.
    floorRise: 0.05,
  };

  /**
   * @returns {{ push(level: number, ms: number): 'continue' | 'end' | 'nothing' | 'max' }}
   */
  function createSilenceDetector(options) {
    const o = Object.assign({}, DEFAULTS, options);
    let floor = null;
    let elapsed = 0;
    let loudRun = 0;
    let spoke = false;
    let quietFor = 0;

    function push(level, ms) {
      elapsed += ms;
      if (floor === null) floor = level;

      const threshold = Math.max(o.minLevel, floor * o.ratio);
      const loud = level >= threshold;

      if (loud) {
        loudRun += 1;
        quietFor = 0;
        if (loudRun >= o.speechChunks) spoke = true;
      } else {
        loudRun = 0;
        quietFor += ms;
        floor = level < floor ? level : floor + (level - floor) * o.floorRise;
      }

      if (elapsed >= o.maxMs) return 'max';
      if (spoke && quietFor >= o.silenceMs) return 'end';
      if (!spoke && elapsed >= o.noSpeechMs) return 'nothing';
      return 'continue';
    }

    return { push };
  }

  root.SilenceDetector = { createSilenceDetector, DEFAULTS };
})(globalThis);
