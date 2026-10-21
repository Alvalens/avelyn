import { blockedBy, type ForegroundWindow } from '../../vision/src/blocklist.ts';
import type { VisionSettings } from '../../vision/src/settings.ts';
import { glancePrompt, isQuiet } from './glance.ts';

/** Never nudge within this long of the user talking to her — covers a recording in progress. */
export const MIN_QUIET_MS = 90_000;

const MINUTE = 60_000;

/** How long since you last talked to her an app change must have been, at least. */
const APP_CHANGE_QUIET_MINUTES = 5;

export interface InitiativeDeps {
  now(): number;
  random(): number;
  settings(): Promise<VisionSettings>;
  foreground(): Promise<ForegroundWindow | null>;
  /** A turn is already in flight. */
  busy(): boolean;
  ask(prompt: string): Promise<string>;
  /** Deliver an unprompted remark to the user. */
  say(text: string): void;
  /**
   * Raised while a nudge runs with "look on her own" off, so the `look` tool
   * itself refuses — the prompt only asks her not to. Optional: absent means
   * nothing enforces it beyond the prompt.
   */
  holdLook?(hold: boolean): Promise<void> | void;
}

export type TickResult =
  | 'off' | 'busy' | 'waiting' | 'blocked' | 'not-yet' | 'quiet' | 'spoke' | 'failed';

/**
 * Decides when she gets the chance to speak first. Everything here is cheap
 * and local; the only expensive step — asking `agy` — happens when every gate
 * has passed, so the cost is bounded by the gap, not by how often this ticks.
 *
 * Restraint itself is not in this file: she can answer `[quiet]`, and the
 * persona (persona/AGENTS.md INITIATIVE) tells her to, usually.
 */
export class Initiative {
  #deps: InitiativeDeps;
  #lastActivity: number;
  #nextAllowed: number | null = null;
  #lastApp: string | null = null;

  constructor(deps: InitiativeDeps) {
    this.#deps = deps;
    this.#lastActivity = deps.now();
  }

  /** The user did something with her (started recording, asked a question). */
  noteUserActivity(): void {
    this.#lastActivity = this.#deps.now();
  }

  async tick(): Promise<TickResult> {
    const d = this.#deps;
    const settings = await d.settings();
    if (!settings.enabled || !settings.initiative) return 'off';

    const now = d.now();
    // Armed on the first tick rather than at construction so a launch greeting
    // is never followed straight away by a second unprompted line.
    this.#nextAllowed ??= now + this.#gap(settings);

    if (d.busy()) return 'busy';
    if (now < this.#nextAllowed) return 'waiting';

    const sinceActivity = now - this.#lastActivity;
    if (sinceActivity < MIN_QUIET_MS) return 'waiting';

    const window = await d.foreground();
    // Reading the window is a PowerShell spawn; the user may have started
    // talking, or a turn begun, while it ran.
    if (d.busy()) return 'busy';
    if (d.now() - this.#lastActivity < MIN_QUIET_MS) return 'waiting';
    if (window && blockedBy(window, settings.blocklist)) return 'blocked';
    // She may look, but nobody can say what is in front: not safe to nudge.
    if (settings.lookOnItsOwn && !window) return 'blocked';

    const app = window?.process ?? null;
    // The baseline is only sampled on ticks that got this far, so after a long
    // chat it is stale: an app change then needs a real stretch of quiet too,
    // not just the 90 seconds every nudge needs.
    const changed =
      app !== null &&
      this.#lastApp !== null &&
      app !== this.#lastApp &&
      sinceActivity >= Math.min(settings.quietMinutes, APP_CHANGE_QUIET_MINUTES) * MINUTE;
    if (app !== null) this.#lastApp = app;

    const longQuiet = sinceActivity >= settings.quietMinutes * MINUTE;
    if (!changed && !longQuiet) return 'not-yet';

    // While she may not look, the tool is told so too, whatever the prompt says.
    const holding = !settings.lookOnItsOwn && d.holdLook !== undefined;
    if (holding) await d.holdLook!(true);

    let reply: string;
    try {
      reply = await d.ask(
        glancePrompt(new Date(now), Math.round(sinceActivity / MINUTE), settings.lookOnItsOwn),
      );
    } catch {
      // An unprompted turn that fails is not worth an error bubble.
      this.#nextAllowed = d.now() + settings.retryGapMinutes * MINUTE;
      return 'failed';
    } finally {
      if (holding) await d.holdLook!(false);
    }

    if (isQuiet(reply)) {
      this.#nextAllowed = d.now() + settings.retryGapMinutes * MINUTE;
      return 'quiet';
    }

    d.say(reply.trim());
    this.#nextAllowed = d.now() + this.#gap(settings);
    return 'spoke';
  }

  #gap(settings: VisionSettings): number {
    const [low, high] = settings.minGapMinutes;
    return (low + this.#deps.random() * (high - low)) * MINUTE;
  }
}
