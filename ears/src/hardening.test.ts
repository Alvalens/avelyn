import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, type VisionSettings } from '../../vision/src/settings.ts';
import { isQuiet } from './glance.ts';
import { Initiative, MIN_QUIET_MS, type InitiativeDeps } from './initiative.ts';

const MIN = 60_000;

function rig(overrides: Partial<VisionSettings> = {}) {
  const clock = { t: Date.UTC(2026, 9, 7, 12, 0) };
  const prompts: string[] = [];
  const said: string[] = [];
  const holds: boolean[] = [];
  const state = {
    settings: { ...DEFAULT_SETTINGS, minGapMinutes: [20, 20] as [number, number], ...overrides },
    window: { process: 'Code', title: 'Avelyn' } as { process: string; title: string } | null,
    busy: false,
    onForeground: undefined as undefined | (() => void),
  };
  const deps: InitiativeDeps = {
    now: () => clock.t,
    random: () => 0.5,
    settings: async () => state.settings,
    foreground: async () => {
      state.onForeground?.();
      return state.window;
    },
    busy: () => state.busy,
    ask: async (prompt) => {
      prompts.push(prompt);
      return 'Hm.';
    },
    say: (text) => said.push(text),
    holdLook: async (hold) => {
      holds.push(hold);
    },
  };
  return { deps, initiative: new Initiative(deps), clock, prompts, said, holds, state };
}

// Final review #9: \W without the u flag treats every non-ASCII character as punctuation.
test('a reply with no ASCII letters is a remark, not silence', () => {
  for (const reply of ['まあね。', '…', '...', '😊', 'うん']) {
    assert.equal(isQuiet(reply), false, reply);
  }
});

test('silence is still recognised after the fix', () => {
  for (const reply of ['[quiet]', ' [Quiet]. ', '[QUIET]!', '', '  \n']) {
    assert.equal(isQuiet(reply), true, JSON.stringify(reply));
  }
});

// Final review #6: the foreground lookup is a PowerShell spawn; the user can start talking during it.
test('the user starting to talk while the window is being read cancels the nudge', async () => {
  const r = rig();
  await r.initiative.tick();
  r.clock.t += 21 * MIN;
  r.state.onForeground = () => r.initiative.noteUserActivity();
  assert.equal(await r.initiative.tick(), 'waiting');
  assert.equal(r.prompts.length, 0);
});

test('a turn that begins while the window is being read cancels the nudge', async () => {
  const r = rig();
  await r.initiative.tick();
  r.clock.t += 21 * MIN;
  r.state.onForeground = () => {
    r.state.busy = true;
  };
  assert.equal(await r.initiative.tick(), 'busy');
  assert.equal(r.prompts.length, 0);
});

// Final review #7: the app-change trigger must not fire right after a conversation.
test('an app change shortly after you talked to her does not nudge', async () => {
  const r = rig({ quietMinutes: 120 });
  await r.initiative.tick(); // arms the gap
  r.clock.t += 21 * MIN; // gap long gone
  r.initiative.noteUserActivity(); // you chatted
  r.clock.t += MIN_QUIET_MS + 10_000; // 100s later: eligible, takes the baseline
  assert.equal(await r.initiative.tick(), 'not-yet');
  r.state.window = { process: 'chrome', title: 'Docs' };
  r.clock.t += MIN;
  assert.equal(await r.initiative.tick(), 'not-yet'); // only ~160s since you talked
  assert.equal(r.prompts.length, 0);
});

// Final review #4
test('with looking off, the no-look hold is raised for the nudge and always released', async () => {
  const r = rig({ lookOnItsOwn: false });
  await r.initiative.tick();
  r.clock.t += 21 * MIN;
  await r.initiative.tick();
  assert.deepEqual(r.holds, [true, false]);
});

test('with looking on, no hold is raised', async () => {
  const r = rig({ lookOnItsOwn: true });
  await r.initiative.tick();
  r.clock.t += 21 * MIN;
  await r.initiative.tick();
  assert.deepEqual(r.holds, []);
});

test('the hold is released even when the nudge fails', async () => {
  const r = rig({ lookOnItsOwn: false });
  r.deps.ask = async () => {
    throw new Error('agy child exited');
  };
  r.initiative = new Initiative(r.deps);
  await r.initiative.tick();
  r.clock.t += 21 * MIN;
  assert.equal(await r.initiative.tick(), 'failed');
  assert.deepEqual(r.holds, [true, false]);
});
