/**
 * The note her session gets when it is a good moment to say something
 * unprompted. Like `[launch]` (greeting.ts) it arrives as an ordinary user turn
 * — the only channel there is — so it is marked and says outright that the
 * user did not say it. persona/AGENTS.md's INITIATIVE section tells her what to do
 * with one; the wording here only has to be unmistakable and give her a way
 * out, because staying silent is the usual right answer.
 */
export function glancePrompt(now: Date, quietMinutes: number, canLook: boolean): string {
  const time = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  const eyes = canLook
    ? 'You may call look to see their screen first. '
    : "You can't look at their screen right now. ";

  return (
    `[glance] It's ${time}. You haven't talked with the user for ${quietMinutes} minutes. ` +
    'This is not something they said. ' +
    eyes +
    'Say one short line only if there is something genuinely worth saying — write it in English first, then say it out loud. ' +
    'Otherwise reply with exactly: [quiet]'
  );
}

/** She chose silence: the marker, or nothing at all. */
export function isQuiet(reply: string): boolean {
  // Not `\W`: without the u flag it counts every non-ASCII character as
  // punctuation, which made a Japanese-only remark look like silence.
  return /^\s*(\[quiet\][\s.!]*)?$/i.test(reply);
}
