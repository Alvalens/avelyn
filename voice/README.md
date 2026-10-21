# voice

Text-to-speech: Avelyn speaks Japanese out loud through [VOICEVOX](https://voicevox.hiroshiba.jp/),
a free local TTS engine popular in the anime-character/VTuber-companion space. English replies stay
as the chat text (the "subtitle"); this package only handles turning a line of text into audio and
playing it.

Plain TypeScript, run directly by Node 24 — no build step, no npm dependencies. VOICEVOX itself
is a separate desktop app/engine process, not an npm package — it must already be running before
anything here will work.

## Setup

1. Install VOICEVOX (`winget install --id HiroshibaKazuyuki.VOICEVOX -e`) and launch it once —
   it runs a local HTTP API on `127.0.0.1:50021` while open.
2. Optionally `cp .env.example .env` and set `VOICEVOX_URL` / `VOICEVOX_SPEAKER_ID` (defaults:
   `http://127.0.0.1:50021`, speaker id `14`). Run `npm run cli -- speakers` to see the full list of
   installed voices and pick an id.

## Usage

    npm run cli -- speakers                          # list available speaker/style ids
    npm run cli -- say "こんにちは"                    # speak text out loud, her baseline delivery
    npm run cli -- say "こんにちは" 14 happy            # with an emotion (speakerId required as a positional slot to reach it)

`src/voicevoxClient.ts` is the thin HTTP wrapper (`audioQuery` + `synthesize`, VOICEVOX's own two-step
API — there's no one-shot "speak" endpoint on the engine itself). `src/tempWav.ts` writes a WAV
`Buffer` to a fresh temp file and returns a `cleanup()`. `src/playAudio.ts` plays a WAV locally via
PowerShell's `Media.SoundPlayer` (always present on Windows, no audio-playback npm dependency
needed) — this is the **CLI-only fallback** used by `npm run cli -- say`; it does not drive AVATAR's
lip sync at all, so use it only for standalone testing without the app running. `src/say.ts` chains
`voicevoxClient` + `playAudio` for that local-only path.

## Emotion-aware delivery

`speak()` (and everything that calls it — `say()`, `engine/`'s `speak` tool) takes an optional
`{ emotion, intensity }`. `emotion` is `happy`/`angry`/`sad`/`relaxed`/`surprised` — the same
vocabulary `expression.set`/`run_action` already use, so a line can sound the same mood her face is
making. `intensity` (0-1, defaults to 1) scales how far the delivery moves from neutral, mirroring
the `weight` bridge's personality actions already use for expressions.

`src/prosody.ts` does the actual work, in two composable pieces:

- **`applyBaseline(query)`** — runs on *every* line, emotion or not. Most turns carry no emotion at
  all, and leaving those at VOICEVOX's raw defaults is what made ordinary conversation read flat, so
  a `BASELINE` lift (intonation up, speed slightly up, pauses slightly tightened) is applied first,
  unconditionally.
- **`applyEmotion(query, emotion, intensity)`** — nudges `speedScale`/`pitchScale`/`intonationScale`/
  `volumeScale`/`pauseLengthScale` toward a hand-tuned per-emotion target, lerped by intensity *from
  whatever the query already carries*. Because the baseline runs first, a full-intensity emotion
  lands on its target while a partial one sits between the baseline and the target.

`pauseLengthScale` is worth knowing about: it controls the dead air between accent phrases, which is
a lever pitch and speed cannot reach. Note it does **not** move uniformly with energy — surprised
and angry are both high-energy but want opposite handling, because tightened pauses made surprised's
ending tumble out and rushed, while they are exactly what makes angry feel pressing. VOICEVOX 0.25.2
exposes it; nothing used it before.

`Emotion` is a **superset** of `ExpressionId`: the five shared words, plus `shy`. The extra one
exists because VRM's face presets are a fixed set with no shy — `shy_flustered` borrows `surprised`
on the face, but borrowing it for the *voice* too made her sound startled rather than flustered, and
the two are near-opposite shapes (surprised is fast and wide-swinging; shy is hesitant and narrow).
So the spoken mood is derived separately, via `PersonalityAction.voiceEmotion` in
`bridge/src/actions.ts`. `engine/`'s tools test asserts `shy_flustered` resolves to a `shy` voice
mood, which is what keeps this union and `bridge`'s `VoiceEmotion` from drifting apart.

The `EMOTION_TARGETS` and `BASELINE` numbers are hand-tuned by ear, not derived — `prosody.ts` is
plain data with no schema, so adjust them directly. `npm run cli -- say "<line>" <speakerId>
<emotion>` for a side-by-side listen. The current values were widened from a first pass that sat
close enough to neutral that even strong reactions still read flat.

`engine/`'s `speak` MCP tool exposes `emotion`/`intensity` directly, and its instructions tell the
calling AI to match whatever `run_action`/`react` expression/weight it used in the same turn, so her
face and voice move together rather than needing two separate judgment calls.

## Latency

`speak()` also trims VOICEVOX's default ~0.1s of leading silence (`prePhonemeLength`) to 0.05s —
real dead air cut before her voice starts, safe since this app's own pipeline (temp-file write, bus
round trip, renderer decode) already gives playback room to start cleanly without the full default
pad. Set `VOICEVOX_DEBUG_TIMING=1` to log each `speak()` call's `audioQuery`/`synthesize`/total
timings to stderr — off by default, since VOICEVOX's own synthesis time is almost certainly the
dominant cost and this is meant for measuring that assumption, not routine noise.

**Considered and rejected:** sending the WAV bytes directly in the `audio.play` bus payload instead
of a temp-file path, to skip the write from this package plus the read back on the AVATAR-fork side.
Not viable — the agent bus caps request bodies at 16KB (`MAX_BODY_BYTES` in
`avatar/avatar/electron/agent-bus.cjs`), far too small for even a short WAV clip, and that cap reads
as a deliberate bound on a locally-reachable HTTP surface, not an oversight to just raise. The
temp-file path is the correct shape for this constraint, not a historical accident — don't revisit
this without first reconsidering whether raising that cap is actually safe.

## Using this from `engine/` (the real path)

`engine/`'s `speak` tool does **not** call `say.ts`. It synthesizes via `voicevoxClient.ts`, writes the
WAV with `tempWav.ts`, then sends AVATAR's local bus a new `audio.play` command (`{ path }`) — the app
itself reads the file, plays it, and drives lip sync directly off that exact clip. That isolation
matters: AVATAR's OS-loopback "Device output" lip-sync source reacts to *anything* playing on the
system (YouTube, music, ...), which made her mouth move for things that weren't her voice. Routing
through `audio.play` means only her own speech ever drives her mouth, regardless of what
`audioSourceId` is set to. See `engine/README.md` and `avatar/avatar/src/hooks/useVoicePlayback.js`.

`agy` calls `speak(text)` with a Japanese translation of its English reply in the same turn it
answers, so Avelyn's voice and her on-screen text stay in sync without a separate translation service.

### How the isolation actually works

AVATAR ends up with two independent, non-interacting audio-reactive systems:

1. **Ambient (`audio.source` / `audioSourceId`)** — the app's continuous listener (mic/system
   loopback/window/file/none). Set to `none` in this setup: `useAudioSource` never opens a capture
   stream at all when it's `none`, so nothing ambient ever drives the mouth.
2. **Voice playback (`audio.play`)** — a one-shot path with its own amplitude analyser, driven only
   by whatever clip AVATAR was just told to play. It has no idea what `audioSourceId` is.

`AvatarStage.jsx` picks between the two every render: whenever a voice-playback clip is active, its
level/speaking signal wins outright, no matter what the ambient source is; the instant the clip ends,
control reverts to the ambient source. Since that's `none`, nothing drives her mouth outside of her
own speech — full isolation, not just priority. See `avatar/avatar/src/hooks/useVoicePlayback.js` and
`avatar/avatar/src/lib/stageCommands.js` (`audio.play`) for the app-side detail.

## Tests

    node --no-warnings --test src/*.test.ts

Only `voicevoxClient.ts` is unit-tested (fetch mocked, same pattern as `bridge/`/`memory/`).
`tempWav.ts`/`playAudio.ts`/`say.ts`/`cli.ts` touch the filesystem/OS directly — like this project's
other OS-facing glue (`server.ts`'s entry point, `cli.ts` elsewhere), that's verified live rather than
under a mock. `engine/`'s `speak` (the real avatar-routed path) *is* unit-tested, since it's just two
`fetch` calls plus a temp-file write — see `engine/src/tools.test.ts`.
