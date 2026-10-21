const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

// A classic script for the bubble page (no modules under its CSP), so it is
// evaluated the way the page evaluates it rather than required.
const context = {};
vm.runInNewContext(
  fs.readFileSync(path.join(__dirname, 'voice-hud', 'silence-detector.js'), 'utf8'),
  context,
);
const { createSilenceDetector } = context.SilenceDetector;

const CHUNK_MS = 85; // what the capture worklet posts at 48 kHz
const ROOM = 0.002;
const VOICE = 0.05;

// Real speech is not a constant level: syllables with short dips between
// them. A steady tone from the first chunk is indistinguishable from a hum.
const TALKING = [VOICE, VOICE, VOICE, ROOM * 2];

/**
 * Feed `ms` of chunks at one level (or cycling through a pattern of levels);
 * returns the first verdict that is not 'continue'.
 */
function feed(detector, level, ms) {
  const levels = Array.isArray(level) ? level : [level];
  for (let t = 0, i = 0; t < ms; t += CHUNK_MS, i += 1) {
    const verdict = detector.push(levels[i % levels.length], CHUNK_MS);
    if (verdict !== 'continue') return verdict;
  }
  return 'continue';
}

test('speech followed by a pause ends the recording', () => {
  const detector = createSilenceDetector();
  assert.equal(feed(detector, ROOM, 300), 'continue');
  assert.equal(feed(detector, VOICE, 2000), 'continue');
  assert.equal(feed(detector, ROOM, 1000), 'continue', 'a 1s pause is mid-sentence');
  assert.equal(feed(detector, VOICE, 500), 'continue');
  assert.equal(feed(detector, ROOM, 1400), 'end');
});

test('quiet before anything is said is not the end of a sentence', () => {
  const detector = createSilenceDetector();
  // Taking a breath before speaking must not stop the recording.
  assert.equal(feed(detector, ROOM, 3000), 'continue');
  assert.equal(feed(detector, VOICE, 1000), 'continue');
  assert.equal(feed(detector, ROOM, 1400), 'end');
});

test('nothing said at all gives up', () => {
  const detector = createSilenceDetector();
  assert.equal(feed(detector, ROOM, 7000), 'nothing');
});

test('one loud chunk — the hotkey\'s own key click — is not speech', () => {
  const detector = createSilenceDetector();
  assert.equal(detector.push(0.3, CHUNK_MS), 'continue');
  assert.equal(feed(detector, ROOM, 7000), 'nothing');
});

test('a recording that never pauses is cut at the cap', () => {
  const detector = createSilenceDetector({ maxMs: 30000 });
  assert.equal(feed(detector, TALKING, 29000), 'continue');
  assert.equal(feed(detector, TALKING, 2000), 'max');
});

test('talking from the very first chunk still counts as speech', () => {
  // The hotkey pressed mid-word: the first level it ever sees is a voice,
  // which briefly passes for the room until the first dip between syllables.
  const detector = createSilenceDetector();
  assert.equal(feed(detector, TALKING, 2000), 'continue');
  assert.equal(feed(detector, ROOM, 1400), 'end');
});

test('a noisy room raises the bar for speech', () => {
  const detector = createSilenceDetector();
  const hum = 0.02; // fan or AC: louder than the absolute minimum
  assert.equal(feed(detector, hum, 1000), 'continue');
  // Talking well over it still counts, and returning to the hum ends it.
  assert.equal(feed(detector, 0.12, 1500), 'continue');
  assert.equal(feed(detector, hum, 1400), 'end');
});

test('a hum alone is not speech', () => {
  const detector = createSilenceDetector();
  assert.equal(feed(detector, 0.02, 7000), 'nothing');
});
