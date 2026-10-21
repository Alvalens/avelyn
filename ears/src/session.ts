import { spawn as nodeSpawn } from 'node:child_process';
import { agyDialect } from './brain/agy.ts';
import type { Brain, AskOptions } from './brain/types.ts';

export type { AskOptions } from './brain/types.ts';

export interface ChildLike {
  stdin: {
    write(chunk: string): void;
    end(): void;
    on(event: 'error', cb: (error: Error) => void): void;
  };
  stdout: { on(event: 'data', cb: (chunk: unknown) => void): void };
  stderr: { on(event: 'data', cb: (chunk: unknown) => void): void };
  on(event: string, cb: (...args: never[]) => void): void;
  kill(): void;
}

export type SpawnFn = (command: string, args: string[], options?: { cwd?: string }) => ChildLike;

/** What one line of a brain's stdout means for the turn in flight. */
export type DialectEvent =
  | { kind: 'session'; id: string; model?: string }
  /** A piece of her text. `step` identifies the text step it belongs to. */
  | { kind: 'text'; step: string; delta: string }
  /**
   * She called her voice (see isVoiceCall): the text step before it is the
   * subtitle. `spoken` is the line the call speaks, once the CLI has shown it.
   */
  | { kind: 'voice'; spoken?: string }
  | { kind: 'done'; ok: true; reply: string }
  | { kind: 'done'; ok: false; error: string };

/**
 * How one CLI speaks NDJSON: the line to write for a user turn, and what a
 * parsed stdout line means. Created per session, so a dialect may keep state
 * (Claude numbers its messages to tell text steps apart).
 */
export interface Dialect {
  encode(text: string): string;
  decode(event: unknown): DialectEvent[];
}

export interface SessionOptions {
  command: string;
  cwd?: string;
  args?: string[];
  /** Defaults to agy's. */
  dialect?: Dialect;
  /** The model asked for (or the CLI's known default), until the CLI reports the real one. */
  model?: string | null;
  /** Injected in tests; defaults to really spawning the process. */
  spawn?: SpawnFn;
}

interface Turn {
  resolve: (reply: string) => void;
  reject: (error: Error) => void;
  /** Her text so far, as it is written — see AskOptions. */
  onText?: (text: string) => void;
}

/**
 * One long-lived brain process holding a single continuous conversation,
 * spoken to in newline-delimited JSON — agy and Claude Code both work this
 * way; the dialect is all that differs between them.
 *
 * Persistent rather than spawned per utterance on purpose: context lives in
 * the process, so she remembers the previous thing you said because she was
 * there for it, with no transcript replay and no re-summarizing.
 */
export class Session implements Brain {
  sessionId: string | null = null;
  model: string | null;

  #child: ChildLike;
  #dialect: Dialect;
  #buffer = '';
  #pending: Turn | null = null;
  #queue: { text: string; turn: Turn }[] = [];
  /** The text step being written for the pending turn. */
  #step: { key: string; text: string } | null = null;
  /** Set at her first voice call: from then on, what she writes is not her line. */
  #voiced = false;
  /** The subtitle, once her voice call has fixed it. */
  #subtitle: string | null = null;
  #closed = false;
  /** Set once the brain is gone; every later ask fails fast with it. */
  #dead: Error | null = null;

  constructor(options: SessionOptions) {
    const spawn = options.spawn ?? (nodeSpawn as unknown as SpawnFn);
    this.#dialect = options.dialect ?? agyDialect();
    this.model = options.model ?? null;
    this.#child = spawn(options.command, options.args ?? agyDialect.args(), { cwd: options.cwd });

    this.#child.stdout.on('data', (chunk) => this.#ingest(String(chunk)));
    this.#child.on('close', () => this.#die(new Error('brain process exited')));
    this.#child.on('error', (error: Error) => this.#die(error));
    // Writing to a dead child raises EPIPE here, as an event. Unhandled, it
    // crashed the whole pipeline instead of failing one turn.
    this.#child.stdin.on('error', (error: Error) => this.#die(error));
  }

  /**
   * Send one utterance and resolve with her reply. Turns are serialized: a
   * second ask queues rather than interleaving into a process that can only
   * handle one turn at a time.
   */
  ask(text: string, options: AskOptions = {}): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      if (this.#dead) {
        reject(this.#dead);
        return;
      }
      const turn: Turn = { resolve, reject, onText: options.onText };
      if (this.#pending) this.#queue.push({ text, turn });
      else this.#begin(text, turn);
    });
  }

  /** The brain is gone and nobody asked it to go — the session is unusable. */
  get died(): boolean {
    return this.#dead !== null && !this.#closed;
  }

  close(): void {
    this.#closed = true;
    this.#die(new Error('session closed'));
    this.#child.kill();
  }

  #begin(text: string, turn: Turn): void {
    this.#pending = turn;
    this.#step = null;
    this.#voiced = false;
    this.#subtitle = null;
    this.#child.stdin.write(this.#dialect.encode(text) + '\n');
  }

  /**
   * stdout arrives in arbitrary chunks that do not respect line boundaries, so
   * buffer and split on newlines rather than parsing each chunk whole. A
   * parser that did the latter would silently drop any event straddling a
   * boundary — showing up only as a turn that never answers.
   */
  #ingest(chunk: string): void {
    this.#buffer += chunk;
    for (let at = this.#buffer.indexOf('\n'); at >= 0; at = this.#buffer.indexOf('\n')) {
      const line = this.#buffer.slice(0, at);
      this.#buffer = this.#buffer.slice(at + 1);
      if (line.trim()) this.#handleLine(line);
    }
  }

  #handleLine(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return; // a CLI may interleave non-JSON diagnostics; they are not turns
    }

    for (const event of this.#dialect.decode(parsed)) {
      if (event.kind === 'session') {
        // Kept so a restart can resume rather than starting over and losing the thread.
        this.sessionId = event.id;
        if (event.model) this.model = event.model;
      } else if (event.kind === 'text') {
        this.#streamText(event.step, event.delta);
      } else if (event.kind === 'voice') {
        this.#voice(event.spoken);
      } else if (!event.ok) {
        this.#settle(new Error(event.error));
      } else {
        // For a turn that was being streamed, the last text she wrote *is* the
        // subtitle already on screen. A CLI's final reply may glue every text
        // step together, so a line written before a tool call and again after
        // it came out twice.
        //
        // And the line before her voice call beats both: Claude follows the
        // call with narration of what it just did, which is not her talking.
        // Nothing at all to show after a voice call is an empty bubble, not
        // the narration that followed it.
        if (this.#voiced) {
          this.#settle(null, this.#subtitle ?? '');
          return;
        }
        const streamed = this.#pending?.onText && this.#step?.text.trim() ? this.#step.text : null;
        this.#settle(null, streamed ?? event.reply);
      }
    }
  }

  /**
   * The subtitle is the line she wrote before her voice call. Seen live: after
   * look or recall she sometimes went straight to speak with no English line,
   * then wrote "Spoken." — so with nothing written first, the line she spoke
   * is shown instead (it is what she said), and it is shown as she says it.
   */
  #voice(spoken: string | undefined): void {
    if (!this.#voiced) {
      this.#voiced = true;
      if (this.#step?.text.trim()) this.#subtitle = this.#step.text;
    }
    if (this.#subtitle !== null || !spoken) return;
    this.#subtitle = spoken;
    try {
      this.#pending?.onText?.(spoken);
    } catch {
      // A subtitle that cannot be shown must not cost her the turn.
    }
  }

  /** Her words as they are written. A new step means she has moved on, so it starts over. */
  #streamText(key: string, delta: string): void {
    if (!this.#pending || delta === '' || this.#voiced) return;
    if (!this.#step || this.#step.key !== key) this.#step = { key, text: '' };
    this.#step.text += delta;

    // Once her line is fixed, later text is narration: never on screen.
    const onText = this.#pending.onText;
    if (!onText) return;
    try {
      onText(this.#step.text);
    } catch {
      // A subtitle that cannot be shown must not cost her the turn.
    }
  }

  #settle(error: Error | null, reply = ''): void {
    const turn = this.#pending;
    this.#pending = null;

    // Start the queued turn BEFORE resolving this one: its request has to be
    // in flight before the awaiting caller can send anything else, or the
    // next result arrives with no turn listening for it.
    const queued = this.#queue.shift();
    if (queued && !this.#closed) this.#begin(queued.text, queued.turn);

    if (!turn) return;
    if (error) turn.reject(error);
    else turn.resolve(reply);
  }

  #die(error: Error): void {
    this.#dead ??= error;
    const queued = this.#queue.splice(0);
    for (const { turn } of queued) turn.reject(error);
    this.#settle(error);
  }
}
