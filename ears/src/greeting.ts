/**
 * The note her session gets when push-to-talk starts fresh, so she greets the
 * user instead of sitting silent until spoken to.
 *
 * It arrives as an ordinary user turn — that is the only channel there is —
 * so it is marked `[launch]` and says outright that the user did not say it.
 * persona/AGENTS.md's LAUNCH section tells her what to do with one. The local time is
 * included because "morning" vs "nearly midnight" is most of what a good
 * greeting knows.
 *
 * `facts` are her durable memories of the user (core memory — small, a few
 * dozen lines at most). Handed over here because every fresh session starts
 * with no context of its own: left to look them up herself, she mostly
 * didn't, and greeted a stranger.
 */
export function greetingPrompt(now: Date, facts: string[] = []): string {
  const day = now.toLocaleDateString('en-GB', { weekday: 'long' });
  const date = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
  const time = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });

  const known = facts.length > 0
    ? `What you remember about them:\n${facts.map((fact) => `- ${fact}`).join('\n')}`
    : 'You remember nothing about them yet.';

  return (
    `[launch] It's ${day}, ${date}, ${time}. The user just started you up — ` +
    "this is not something they said. Greet them in one short line: write it in English first, " +
    "then say it out loud, then wait. " +
    "Don't log the greeting as a memory; a start-up isn't an episode.\n\n" +
    known
  );
}
