# engine

The first thing that actually wires `bridge/`, `memory/`, and `voice/` together, and the first
tools any AI CLI you're chatting in (Antigravity CLI, Claude Code, ...) can call to control
Avelyn, use her memory, and make her speak — an MCP server, over stdio.

Plain TypeScript, run directly by Node 24 — no build step. Imports `bridge/src/runAction.ts`,
`memory/src/memoryStore.ts`, and `voice/src/voicevoxClient.ts`/`tempWav.ts` directly as sibling-folder
TS modules rather than duplicating logic or hopping through HTTP. `@modelcontextprotocol/sdk` and
`zod` are real dependencies here (same versions AVATAR's own fork uses for its MCP server) — this
package isn't zero-dependency like `bridge/`/`memory/`/`voice/`, since an MCP server needs the
protocol SDK.

## Setup

    npm install
    # Nothing else: the bus address and token come from the runtime file the avatar
    # app keeps (%LOCALAPPDATA%\avelyn\runtime.json), re-read on every command.
    # VOICEVOX must be running for speak. A .env (from .env.example) is optional.

## Tools

- `list_actions` — every personality action id + description. Call this before `run_action`/`react`
  with an id you haven't seen.
- `run_action(action)` — fires a personality action (bridge's `runAction`; auto-resets to idle on
  its own).
- **`react(action, note?, speechText?, speakerId?)`** — the composite one: fires the action *and*
  logs an episode to recall memory in the same call, using `note` for context. Nothing is logged if
  the action itself fails. Pass `speechText` (a Japanese line) to also voice a reply through VOICEVOX
  at the same time — **preferred over a separate `speak` call whenever you're also reacting**:
  synthesis starts alongside the gesture's bus calls instead of only after `react` resolves (VOICEVOX's
  own audioQuery+synthesize is the slow part, ~0.5-1.5s for a typical line — see
  `voice/README.md`'s Latency section). Speech still plays even if the action id is unknown
  (flat/neutral delivery) — it's independent of the action's outcome, same as standalone `speak`.
  Fixes a real bug: calling `react` then `speak` as two sequential tool calls meant the gesture (often
  only 2-3s) had frequently already finished by the time voice synthesis caught up, reading as
  "animation ends, then she talks" instead of the two together.
  **`expression.set` is skipped entirely whenever `speechText` is passed** (`bridge/src/runAction.ts`'s
  `skipExpression`, driven automatically by `react` — `result.action.autoReset` is `false` in this
  case, since there's nothing to auto-clear): a held facial expression (e.g. "surprised" at full
  weight) fighting the mouth's own lip-sync visemes for the whole line reads as a static, uncanny face
  — confirmed live. The body gesture (`animation.play`) still fires normally; voice prosody still
  carries the action's `voiceEmotion` (falling back to `expressionId`) at its `weight` as
  `emotion`/`intensity` (see `voice/README.md`'s Emotion-aware delivery section) — only the *face*
  preset is left out while she's talking. The voice mood is separate from the face one on purpose:
  an action whose face borrows a VRM preset can still have its own spoken shape. An expression-only action (no `animationId`) with `speechText` therefore makes no
  bus calls beyond the speech itself: no visual reaction, just the line.
- `speak(text, speakerId?, emotion?, intensity?)` — standalone voice, for a turn with **no** reaction
  to pair it with (prefer `react`'s `speechText` whenever you are reacting this turn). Synthesizes
  `text` through VOICEVOX and sends it to AVATAR to play via the `audio.play` bus command — the app
  plays it and drives lip sync directly off that clip, isolated from whatever else the system is
  playing (unlike its OS-loopback "Device output" audio source, which reacts to anything). Pass the
  Japanese translation of your reply; the English stays in the chat response as the subtitle.
  `emotion` (`happy`/`angry`/`sad`/`relaxed`/`surprised`/`shy`, same vocabulary as `run_action`'s
  expressions plus the voice-only `shy`) and `intensity` (0-1) shape the delivery — see
  `voice/README.md`'s Emotion-aware delivery section. Doesn't touch memory. Requires VOICEVOX and
  AVATAR to both be running.
- `look()` — takes a screenshot of the whole screen into `vision/captures/` and returns the file path; she opens the image herself. Refuses (with a plain sentence, never the blocked window's title) when vision is switched off, the window in front is on the blocklist, or the window can't be determined. Reads the vision settings from the app's runtime file (`%LOCALAPPDATA%\avelyn\runtime.json`) on every call. See `vision/README.md`.
- `remember(category, content, subject?)` / `recall_facts(query)` / `list_facts(category?)` —
  durable facts (identity/preference/relationship/project/fact).
- `recall_memories(query)` — search episodes/conversations.

## Registering with an MCP host

For push-to-talk, Claude Code and Codex are handed the engine on every launch
(`ears/src/brain/`) — nothing to register. agy has no per-launch flag, so it is
registered once, with this repo's path (`Check-Avelyn.ps1` prints the exact command):

    agy mcp add avelyn-engine node -- --no-warnings "<repo>\engine\src\server.ts"

To use her tools from a typed session in any MCP host, the config shape is the usual one:

```json
{
  "mcpServers": {
    "avelyn-engine": {
      "command": "node",
      "args": ["--no-warnings", "<repo>/engine/src/server.ts"]
    }
  }
}
```

## Tests

    node --no-warnings --test src/*.test.ts

`src/tools.ts` holds the actual logic, independent of the MCP wiring in `src/server.ts` — same
separation `stageCommands.js` uses in the AVATAR fork. Tests exercise `tools.ts` directly: bridge's
`fetch` is mocked, memory uses a `:memory:` database, and reset timing is overridden to run fast
(see `bridge/`'s own tests for why — the same `AutoResetOptions` override applies here).
