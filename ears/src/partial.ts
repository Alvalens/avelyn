export interface PartialEmitter {
  /** The text so far. Sent at once if the interval is up, otherwise held and sent when it is. */
  push(text: string): void;
  /** Drop anything still waiting — the final reply is about to supersede it. */
  cancel(): void;
}

/**
 * Rate-limits streamed subtitle text. Her words arrive a few characters at a
 * time; sending each would flood the bubble's IPC and re-run its layout for
 * every one. The first piece goes out immediately (so the subtitle appears the
 * moment she starts), then at most one per interval, always the latest, so the
 * end of what she has said is never left stranded in the buffer.
 */
export function createPartialEmitter(send: (text: string) => void, intervalMs = 100): PartialEmitter {
  let lastSentAt = Number.NEGATIVE_INFINITY;
  let pending: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function flush(): void {
    timer = null;
    if (pending === null) return;
    const text = pending;
    pending = null;
    lastSentAt = Date.now();
    send(text);
  }

  return {
    push(text) {
      // A blank bubble would flash empty before her first word.
      if (!text.trim()) return;
      const wait = lastSentAt + intervalMs - Date.now();
      if (wait <= 0 && timer === null) {
        lastSentAt = Date.now();
        pending = null;
        send(text);
        return;
      }
      pending = text;
      if (timer === null) timer = setTimeout(flush, Math.max(0, wait));
    },
    cancel() {
      pending = null;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
