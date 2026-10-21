import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, type VisionSettings } from '../../vision/src/settings.ts';
import { Initiative, MIN_QUIET_MS, type InitiativeDeps } from './initiative.ts';

const MIN = 60_000;

interface Rig {
  deps: InitiativeDeps;
  initiative: Initiative;
  clock: { t: number };
  said: string[];
  prompts: string[];
  state: {
    settings: VisionSettings;
    window: { process: string; title: string } | null;
    busy: boolean;
    reply: string | Error;
  };
}

function rig(overrides: Partial<VisionSettings> = {}): Rig {
  const clock = { t: Date.UTC(2026, 9, 7, 12, 0) };
  const said: string[] = [];
  const prompts: string[] = [];
  const state = {
    settings: { ...DEFAULT_SETTINGS, minGapMinutes: [20, 20] as [number, number], ...overrides },
    window: { process: 'Code', title: 'Avelyn' } as Rig['state']['window'],
    busy: false,
    reply: 'Still at it.' as string | Error,
  };
  const deps: InitiativeDeps = {
    now: () => clock.t,
    random: () => 0.5,
    settings: async () => state.settings,
    foreground: async () => state.window,
    busy: () => state.busy,
    ask: async (prompt) => {
      prompts.push(prompt);
      if (state.reply instanceof Error) throw state.reply;
      return state.reply;
    },
    say: (text) => said.push(text),
  };
  return { deps, initiative: new Initiative(deps), clock, said, prompts, state };
}

test('she does not speak right after starting up (the launch greeting covers that)', async () => {
  const r = rig();
  assert.equal(await r.initiative.tick(), 'waiting');
  assert.equal(r.prompts.length, 0);
});

test('after the gap and a long quiet, she is nudged and her remark is delivered', async () => {
  const r = rig();
  await r.initiative.tick(); // arms the gap
  r.clock.t += 21 * MIN;
  assert.equal(await r.initiative.tick(), 'spoke');
  assert.equal(r.prompts.length, 1);
  assert.deepEqual(r.said, ['Still at it.']);
  assert.match(r.prompts[0], /^\[glance\]/);
});

test('the nudge mentions the quiet stretch in whole minutes', async () => {
  const r = rig();
  await r.initiative.tick();
  r.clock.t += 21 * MIN;
  await r.initiative.tick();
  assert.match(r.prompts[0], /21 minutes/);
});

test('[quiet] shows nothing and the shorter retry cooldown applies', async () => {
  const r = rig();
  await r.initiative.tick();
  r.clock.t += 21 * MIN;
  r.state.reply = '[quiet]';
  assert.equal(await r.initiative.tick(), 'quiet');
  assert.deepEqual(r.said, []);

  r.clock.t += 5 * MIN; // inside the 10 minute retry gap
  assert.equal(await r.initiative.tick(), 'waiting');

  r.clock.t += 6 * MIN; // past it
  r.state.reply = 'Hm.';
  assert.equal(await r.initiative.tick(), 'spoke');
});

test('an empty reply counts as silence too', async () => {
  const r = rig();
  await r.initiative.tick();
  r.clock.t += 21 * MIN;
  r.state.reply = '';
  assert.equal(await r.initiative.tick(), 'quiet');
  assert.deepEqual(r.said, []);
});

test('after she speaks, the full gap applies before the next remark', async () => {
  const r = rig();
  await r.initiative.tick();
  r.clock.t += 21 * MIN;
  await r.initiative.tick();
  r.clock.t += 19 * MIN;
  assert.equal(await r.initiative.tick(), 'waiting');
  r.clock.t += 2 * MIN;
  assert.equal(await r.initiative.tick(), 'spoke');
});

test('talking to her recently holds the nudge back', async () => {
  const r = rig();
  await r.initiative.tick();
  r.clock.t += 21 * MIN;
  r.initiative.noteUserActivity();
  r.clock.t += MIN_QUIET_MS - 1_000;
  assert.equal(await r.initiative.tick(), 'waiting');
  assert.equal(r.prompts.length, 0);
});

test('mid-turn means no nudge at all', async () => {
  const r = rig();
  await r.initiative.tick();
  r.clock.t += 21 * MIN;
  r.state.busy = true;
  assert.equal(await r.initiative.tick(), 'busy');
  assert.equal(r.prompts.length, 0);
});

test('switched off, or the master vision switch off, means nothing happens', async () => {
  for (const off of [{ initiative: false }, { enabled: false }]) {
    const r = rig(off);
    await r.initiative.tick();
    r.clock.t += 60 * MIN;
    assert.equal(await r.initiative.tick(), 'off');
    assert.equal(r.prompts.length, 0);
  }
});

test('a blocklisted window in front means no nudge', async () => {
  const r = rig();
  await r.initiative.tick();
  r.clock.t += 21 * MIN;
  r.state.window = { process: 'KeePass.exe', title: 'Passwords' };
  assert.equal(await r.initiative.tick(), 'blocked');
  assert.equal(r.prompts.length, 0);
});

test('if she may look but the window cannot be determined, no nudge', async () => {
  const r = rig();
  await r.initiative.tick();
  r.clock.t += 21 * MIN;
  r.state.window = null;
  assert.equal(await r.initiative.tick(), 'blocked');
  assert.equal(r.prompts.length, 0);
});

test('if she may not look, an unknown window does not stop a time-based remark', async () => {
  const r = rig({ lookOnItsOwn: false });
  await r.initiative.tick();
  r.clock.t += 21 * MIN;
  r.state.window = null;
  assert.equal(await r.initiative.tick(), 'spoke');
  assert.doesNotMatch(r.prompts[0], /call look/i);
});

test('an app change brings the nudge sooner than the long quiet would', async () => {
  const r = rig({ quietMinutes: 120 });
  await r.initiative.tick(); // arms the gap
  r.clock.t += 21 * MIN;
  assert.equal(await r.initiative.tick(), 'not-yet'); // first sample: baseline only
  r.state.window = { process: 'chrome', title: 'Docs' };
  r.clock.t += MIN;
  assert.equal(await r.initiative.tick(), 'spoke');
});

test('the same app, and not quiet for long, means not yet', async () => {
  const r = rig({ quietMinutes: 120 });
  await r.initiative.tick();
  r.clock.t += 21 * MIN;
  assert.equal(await r.initiative.tick(), 'not-yet');
  r.clock.t += MIN;
  assert.equal(await r.initiative.tick(), 'not-yet');
  assert.equal(r.prompts.length, 0);
});

test('agy failing does not throw, and cools down instead of retrying every minute', async () => {
  const r = rig();
  await r.initiative.tick();
  r.clock.t += 21 * MIN;
  r.state.reply = new Error('agy child exited');
  assert.equal(await r.initiative.tick(), 'failed');
  assert.deepEqual(r.said, []);

  r.clock.t += MIN;
  assert.equal(await r.initiative.tick(), 'waiting');
});

test('the gap is drawn from the configured range', async () => {
  const r = rig({ minGapMinutes: [20, 40] });
  r.deps.random = () => 1; // longest gap
  r.initiative = new Initiative(r.deps);
  await r.initiative.tick(); // arms: 40 minutes
  r.clock.t += 39 * MIN;
  assert.equal(await r.initiative.tick(), 'waiting');
  r.clock.t += 2 * MIN;
  assert.equal(await r.initiative.tick(), 'spoke');
});
