import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyEmotion, applyBaseline } from './prosody.ts';

const NEUTRAL = { speedScale: 1, pitchScale: 0, intonationScale: 1, volumeScale: 1, pauseLengthScale: 1 };

// Float arithmetic on lerped scales does not land on clean decimals, so exact
// equality is the wrong assertion for anything below full intensity.
function assertClose(actual: Record<string, unknown>, expected: Record<string, number>) {
  for (const [key, value] of Object.entries(expected)) {
    const got = actual[key];
    assert.equal(typeof got, 'number', `${key} should be a number, got ${typeof got}`);
    assert.ok(
      Math.abs((got as number) - value) < 1e-9,
      `${key}: expected ~${value}, got ${got}`,
    );
  }
}

test('applyBaseline lifts a query that carries no emotion at all', () => {
  // Plain-talk turns reach `speak` with no emotion (persona/AGENTS.md invites omitting
  // it), which used to skip applyEmotion entirely and send every scale at
  // VOICEVOX's raw default — the flat read, on the majority of lines.
  const query = applyBaseline(NEUTRAL);

  assert.ok(query.intonationScale as number > 1, 'intonation should carry most of the lift');
  assert.ok(query.speedScale as number > 1, 'speed should be nudged up');
  assert.ok(query.pauseLengthScale as number < 1, 'pauses should tighten');
});

test('applyBaseline preserves fields it does not shape', () => {
  const query = applyBaseline({ ...NEUTRAL, accentPhrases: ['x'], prePhonemeLength: 0.05 });

  assert.deepEqual(query.accentPhrases, ['x']);
  assert.equal(query.prePhonemeLength, 0.05);
});

test('applyEmotion at full intensity lands exactly on the hand-tuned target', () => {
  const query = applyEmotion(NEUTRAL, 'happy', 1);

  assert.deepEqual(query, {
    speedScale: 1.08,
    pitchScale: 0.05,
    intonationScale: 1.35,
    volumeScale: 1.03,
    pauseLengthScale: 0.88,
  });
});

test('applyEmotion shapes pauseLengthScale too, not just the four original scales', () => {
  // Pauses between phrases are a delivery lever pitch cannot reach — dead air
  // is a large part of what reads as flat. VOICEVOX 0.25.2 exposes
  // pauseLengthScale; nothing here touched it before.
  //
  // Angry, not surprised: a listening pass found surprised's ending tumbling
  // out at tightened pauses, so surprised now stretches them instead. High
  // energy does not uniformly mean "snappier" — surprised is clipped, angry is
  // pressing, and those want opposite pause handling.
  const tense = applyEmotion(NEUTRAL, 'angry', 1);
  const low = applyEmotion(NEUTRAL, 'sad', 1);

  assert.ok(tense.pauseLengthScale as number < 1, 'angry should tighten pauses');
  assert.ok(low.pauseLengthScale as number > 1, 'sad should stretch them');
  assert.ok(
    (applyEmotion(NEUTRAL, 'surprised', 1).pauseLengthScale as number) > 1,
    'surprised stretches too — tightened pauses made its ending read as rushed',
  );
});

test('shy has its own target — it is not a quieter surprised', () => {
  // shy_flustered used to borrow the `surprised` target at weight 0.8, which
  // is close to the opposite shape: surprised is fast with wide pitch swings,
  // shy is hesitant and narrow. Tuning surprised could never produce shy, and
  // a listening pass against bracket variants picked this shape.
  const shy = applyEmotion(NEUTRAL, 'shy', 1);
  const surprised = applyEmotion(NEUTRAL, 'surprised', 1);

  assertClose(shy, {
    speedScale: 1.0,
    pitchScale: 0.04,
    intonationScale: 1.15,
    volumeScale: 0.9,
    pauseLengthScale: 1.15,
  });
  assert.ok(
    (shy.intonationScale as number) < (surprised.intonationScale as number),
    'shy should swing less than surprised',
  );
  assert.ok((shy.volumeScale as number) < 1, 'shy should be quieter than neutral');
});

test('applyEmotion at intensity 0 leaves the query untouched', () => {
  const query = applyEmotion(NEUTRAL, 'sad', 0);

  assertClose(query, NEUTRAL);
});

test('applyEmotion at partial intensity lerps halfway to the target', () => {
  const query = applyEmotion(NEUTRAL, 'angry', 0.5);

  assertClose(query, {
    speedScale: 1.025,
    pitchScale: 0.01,
    intonationScale: 1.3,
    volumeScale: 1.05,
    pauseLengthScale: 0.975,
  });
});

test('applyEmotion clamps intensity outside 0-1', () => {
  const over = applyEmotion(NEUTRAL, 'surprised', 5);
  const under = applyEmotion(NEUTRAL, 'surprised', -5);

  assert.deepEqual(over, applyEmotion(NEUTRAL, 'surprised', 1));
  assertClose(under, NEUTRAL);
});

test('applyEmotion defaults intensity to 1 when omitted', () => {
  const withDefault = applyEmotion(NEUTRAL, 'relaxed');
  const explicit = applyEmotion(NEUTRAL, 'relaxed', 1);

  assert.deepEqual(withDefault, explicit);
});

test('applyEmotion lerps from whatever scale values the query already carries, not always NEUTRAL', () => {
  // This is what makes the baseline compose: `speak` applies applyBaseline
  // first, so at intensity 1 an emotion still lands exactly on its target,
  // while at partial intensity it sits between the baseline and the target
  // rather than between VOICEVOX's default and the target.
  const query = applyEmotion({ ...NEUTRAL, speedScale: 1.2, pitchScale: 0.1 }, 'sad', 1);

  // Tolerance, not equality: lerping to the target accumulates float noise
  // (0.1 -> -0.04 round-trips as -0.04000000000000001). The value is the
  // target; the last bit of it is not what this test is about.
  assertClose(query, { speedScale: 0.9, pitchScale: -0.04 });
});

test('applyEmotion preserves fields it does not touch', () => {
  const query = applyEmotion({ ...NEUTRAL, accentPhrases: ['x'] }, 'happy', 1);

  assert.deepEqual(query.accentPhrases, ['x']);
});

test('master volume lifts every line by the same factor, after the mood is applied', async () => {
  const { applyMasterVolume, MASTER_VOLUME } = await import('./prosody.ts');
  assert.ok(MASTER_VOLUME > 1 && MASTER_VOLUME <= 1.5, 'a modest boost, not a blast');

  const plain = applyMasterVolume({ volumeScale: 1 });
  assert.equal(plain.volumeScale, MASTER_VOLUME);

  // The mood still reads: a sad line stays quieter than a plain one.
  const sad = applyMasterVolume(applyEmotion(applyBaseline({}), 'sad'));
  assert.ok((sad.volumeScale as number) < (plain.volumeScale as number));
  assert.ok((sad.volumeScale as number) > 0.88, 'but it is louder than it used to be');
});

test('master volume leaves the other fields alone and tolerates a missing volumeScale', async () => {
  const { applyMasterVolume, MASTER_VOLUME } = await import('./prosody.ts');
  const out = applyMasterVolume({ speedScale: 1.2, outputSamplingRate: 24000 });
  assert.equal(out.speedScale, 1.2);
  assert.equal(out.outputSamplingRate, 24000);
  assert.equal(out.volumeScale, MASTER_VOLUME);
});

test('master volume is capped so a line cannot be pushed into clipping', async () => {
  const { applyMasterVolume } = await import('./prosody.ts');
  assert.ok((applyMasterVolume({ volumeScale: 5 }).volumeScale as number) <= 1.6);
});
