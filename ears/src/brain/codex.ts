import { spawn as nodeSpawn } from 'node:child_process';
import type { ChildLike, SpawnFn } from '../session.ts';
import { isVoiceCall, spokenLine, type AskOptions, type Brain } from './types.ts';
import type { EngineLaunch } from './claude.ts';

export interface CodexOptions {
  command: string;
  cwd: string;
  engine: EngineLaunch;
  model?: string;
  /** A thread id to pick up again, after a crash. */
  resume?: string;
  spawn?: SpawnFn;
}

interface Turn {
  text: string;
  resolve: (reply: string) => void;
  reject: (error: Error) => void;
  onText?: (text: string) => void;
}

interface RpcMessage {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { message?: string };
}

/**
 * Codex through `codex app-server`: JSON-RPC over stdio, one thread for the
 * whole conversation, a `turn/start` per utterance.
 *
 * Not `codex exec --json`, which also works: it prints no text until the turn
 * is over, and costs a fresh process (and a fresh engine) per turn — about
 * 11s for a one-word reply, against ~5s cold here and less once warm.
 * app-server is marked experimental, so everything that knows its protocol is
 * in this file.
 */
export class CodexSession implements Brain {
  sessionId: string | null = null;
  model: string | null;

  #child: ChildLike;
  #buffer = '';
  #nextId = 1;
  #waiting = new Map<number, { resolve: (result: unknown) => void; reject: (error: Error) => void }>();
  #ready: Promise<void>;
  #pending: Turn | null = null;
  #queue: Turn[] = [];
  /** The message being streamed, and the last one she finished. */
  #step: { id: string; text: string } | null = null;
  #lastMessage: string | null = null;
  /** Set at her first voice call: a message written after it is narration, not shown. */
  #voiced = false;
  #subtitle: string | null = null;
  #closed = false;
  #dead: Error | null = null;

  constructor(options: CodexOptions) {
    const spawn = options.spawn ?? (nodeSpawn as unknown as SpawnFn);
    this.model = options.model ?? null;
    this.#child = spawn(options.command, ['app-server'], { cwd: options.cwd });

    this.#child.stdout.on('data', (chunk) => this.#ingest(String(chunk)));
    this.#child.on('close', () => this.#die(new Error('brain process exited')));
    this.#child.on('error', (error: Error) => this.#die(error));
    this.#child.stdin.on('error', (error: Error) => this.#die(error));

    this.#ready = this.#open(options);
    // A thread that never starts leaves her unusable: same as the process dying.
    this.#ready.catch((error: Error) => this.#die(error));
  }

  ask(text: string, options: AskOptions = {}): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      if (this.#dead) {
        reject(this.#dead);
        return;
      }
      const turn: Turn = { text, resolve, reject, onText: options.onText };
      if (this.#pending) this.#queue.push(turn);
      else this.#begin(turn);
    });
  }

  get died(): boolean {
    return this.#dead !== null && !this.#closed;
  }

  close(): void {
    this.#closed = true;
    this.#die(new Error('session closed'));
    this.#child.kill();
  }

  async #open(options: CodexOptions): Promise<void> {
    await this.#request('initialize', {
      clientInfo: { name: 'avelyn', title: 'Avelyn', version: '0.1.0' },
      capabilities: null,
    });
    this.#send({ method: 'initialized', params: {} });

    const overrides = {
      cwd: options.cwd,
      ...(options.model ? { model: options.model } : {}),
      // Headless: nobody is there to approve anything. Her own tools are MCP
      // calls; the sandbox only bounds any shell command she might try.
      approvalPolicy: 'never',
      sandbox: 'read-only',
      config: {
        mcp_servers: { 'avelyn-engine': options.engine },
        // The user's Codex memories are about their coding sessions, not her.
        features: { memories: false },
      },
    };
    const result = options.resume
      ? await this.#request('thread/resume', { threadId: options.resume, ...overrides })
      : await this.#request('thread/start', { ...overrides, serviceName: 'avelyn' });
    const started = result as { thread?: { id?: string }; model?: string };
    this.sessionId = started.thread?.id ?? null;
    if (started.model) this.model = started.model;
  }

  async #begin(turn: Turn): Promise<void> {
    this.#pending = turn;
    this.#step = null;
    this.#lastMessage = null;
    this.#voiced = false;
    this.#subtitle = null;
    try {
      await this.#ready;
      await this.#request('turn/start', {
        threadId: this.sessionId,
        input: [{ type: 'text', text: turn.text, text_elements: [] }],
      });
    } catch (error) {
      if (this.#pending === turn) this.#settle(error as Error);
    }
  }

  #request(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (this.#dead) return Promise.reject(this.#dead);
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      this.#waiting.set(id, { resolve, reject });
      this.#send({ id, method, params });
    });
  }

  #send(message: RpcMessage): void {
    this.#child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
  }

  #ingest(chunk: string): void {
    this.#buffer += chunk;
    for (let at = this.#buffer.indexOf('\n'); at >= 0; at = this.#buffer.indexOf('\n')) {
      const line = this.#buffer.slice(0, at);
      this.#buffer = this.#buffer.slice(at + 1);
      if (!line.trim()) continue;
      let message: RpcMessage;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      this.#handle(message);
    }
  }

  #handle(message: RpcMessage): void {
    // A response to something we asked.
    if (message.id !== undefined && message.method === undefined) {
      const waiter = this.#waiting.get(message.id);
      this.#waiting.delete(message.id);
      if (!waiter) return;
      if (message.error) waiter.reject(new Error(message.error.message ?? 'codex request failed'));
      else waiter.resolve(message.result);
      return;
    }

    // A request from the server — an approval, an elicitation. Nobody is there
    // to answer it, and a turn waiting on one would hang forever: decline.
    if (message.id !== undefined) {
      this.#send({ id: message.id, error: { message: 'Avelyn runs headless; nothing can be approved.' } });
      return;
    }

    const params = message.params ?? {};
    switch (message.method) {
      case 'item/agentMessage/delta':
        this.#streamText(String(params.itemId), String(params.delta ?? ''));
        break;
      case 'item/started': {
        const item = params.item as { type?: string; server?: string; tool?: string; arguments?: unknown } | undefined;
        if (item?.type !== 'mcpToolCall' || !isVoiceCall(item.server, item.tool) || this.#voiced) break;
        this.#voiced = true;
        // Her line before the call; failing that, the line the call speaks (see Session#voice).
        const written = this.#lastMessage ?? this.#step?.text ?? null;
        const line = written?.trim() ? written : spokenLine(item.tool, item.arguments) ?? null;
        if (!line) break;
        this.#subtitle = line;
        if (line !== written) {
          try {
            this.#pending?.onText?.(line);
          } catch {
            // A subtitle that cannot be shown must not cost her the turn.
          }
        }
        break;
      }
      case 'item/completed': {
        const item = params.item as { type?: string; text?: string } | undefined;
        if (item?.type === 'agentMessage' && typeof item.text === 'string' && !this.#voiced) this.#lastMessage = item.text;
        break;
      }
      case 'turn/completed': {
        const turn = params.turn as { status?: string; error?: { message?: string } | null } | undefined;
        if (turn?.status === 'completed' && this.#voiced) this.#settle(null, this.#subtitle ?? '');
        else if (turn?.status === 'completed') this.#settle(null, this.#lastMessage ?? this.#step?.text ?? '');
        else this.#settle(new Error(turn?.error?.message || `codex turn ${turn?.status ?? 'failed'}`));
        break;
      }
    }
  }

  #streamText(id: string, delta: string): void {
    const onText = this.#pending?.onText;
    if (!onText || delta === '' || this.#voiced) return;
    if (!this.#step || this.#step.id !== id) this.#step = { id, text: '' };
    this.#step.text += delta;
    try {
      onText(this.#step.text);
    } catch {
      // A subtitle that cannot be shown must not cost her the turn.
    }
  }

  #settle(error: Error | null, reply = ''): void {
    const turn = this.#pending;
    this.#pending = null;

    const queued = this.#queue.shift();
    if (queued && !this.#closed && !this.#dead) void this.#begin(queued);

    if (!turn) return;
    if (error) turn.reject(error);
    else turn.resolve(reply);
  }

  #die(error: Error): void {
    this.#dead ??= error;
    for (const waiter of this.#waiting.values()) waiter.reject(error);
    this.#waiting.clear();
    for (const turn of this.#queue.splice(0)) turn.reject(error);
    this.#settle(error);
  }
}
