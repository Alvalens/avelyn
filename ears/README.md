# ears

Speech-to-text and the long-lived brain conversation (agy, Claude Code or Codex) behind push-to-talk. Everything here is plain,
tested TypeScript; the avatar app only owns the hotkey, mic and bubble (see below).

Plain TypeScript run directly by Node 24 (native type stripping). Zero dependencies — `whisper-cli`
and her brain CLI are spawned as child processes.

## Pieces

- `src/transcribe.ts` — 16 kHz mono PCM → WAV (`src/wav.ts`) → `whisper-cli -l en -nt`. A non-zero
  exit throws rather than returning an empty transcript: "you said nothing" and "whisper is broken"
  must not look the same. Passes `--prompt` only if `WHISPER_PROMPT` is set (off by default), then
  runs the transcript through `correctTranscript`.
- `src/transcript.ts` — `parseTranscript` (stdout is already clean text); `looksLikeSilence`,
  which drops whole-utterance whisper hallucinations on silent audio (`You`, `[BLANK_AUDIO]`, ...)
  — whole-transcript match only, and "Thank you."/"Bye." survive when the raw input peak shows real
  signal (`SPEECH_PEAK` = 0.02); `correctTranscript`, which fixes known mishearings after the fact
  (`Evelyn` → `Avelyn`). Prompting whisper with her name instead made it skip a spoken
  "Hi Avelyn." — it treats prompt text as already said.
- `src/greeting.ts` — the `[launch]` note sent first on a fresh pipeline (`AVELYN_GREET=1`), so she
  greets you. See persona/AGENTS.md's LAUNCH section.
- `src/brain/` — her brain, one adapter per CLI behind one `Brain` interface: agy and Claude Code
  through `src/session.ts` (one persistent child in NDJSON stream mode, with a per-CLI dialect),
  Codex through `codex app-server` (JSON-RPC). Persistent on purpose: she remembers the last thing
  you said because she was there for it. Turns are serialized. If the chosen CLI is not installed,
  the first installed one is used (`resolveProvider`). CLIs are spawned without a shell, so they
  must be real `.exe`s — the native installers, not npm `.cmd` shims (or set `AVELYN_BRAIN_BINARY`).
- `src/home.ts` — her working folder outside the repo (`%LOCALAPPDATA%\avelyn\home`), with
  `persona/AGENTS.md` copied in on every start.
- `src/pipeline.ts` — the process the avatar app spawns for push-to-talk: NDJSON commands in
  (`ask {pcmPath, sampleRate}`, `close`), events out (`ready`, `transcript`, `silent`, `reply`,
  `error`). Spawned at app launch so agy's cold start (~26 s vs ~3 s warm) is paid before you speak.
- `src/config.ts` — paths, all overridable by env:

  | Env | Default |
  |---|---|
  | `AVELYN_BRAIN_BINARY` | the brain CLI's `.exe` — looked up on PATH, then where each installer puts it (`spawn` won't apply PATHEXT) |
  | `AGY_BINARY` | older name, still honoured for agy |
  | `WHISPER_BINARY` | `%LOCALAPPDATA%\avelyn\whisper\bin\Release\whisper-cli.exe` |
  | `WHISPER_MODEL` | `%LOCALAPPDATA%\avelyn\whisper\models\ggml-base.en.bin` |
  | `WHISPER_PROMPT` | empty — see `correctTranscript` for why not her name |
  | `AVELYN_PROJECT_DIR` | `%LOCALAPPDATA%\avelyn\home` — her session's cwd, outside the repo; `persona/AGENTS.md` is copied in on every start (`src/home.ts`). Set by hand, it is used as is and nothing is copied. |
  | `AVELYN_HOME` | overrides that default home folder |
  | `AVELYN_BRAIN` / `AVELYN_BRAIN_MODEL` | set by the app from Settings → Brain (`agy`, `claude`, `codex`) |

## Push-to-talk (in the avatar app)

The hotkey, microphone and subtitle bubble live in the avatar app
(`avatar/avatar/electron/voice-hud.cjs`, bubble files in `electron/voice-hud/`), configured in
Settings → Voice input (`voice:` in config.yaml). It spawns `src/pipeline.ts` under the system
Node 24 — Electron 34's own Node 20 can't strip types. Switching voice off (or quitting) sends the
pipeline `close`, which ends agy itself; it is only force-killed if still alive 3 s later, since on
Windows a killed parent leaves its children running.

Mic checks, from `avatar/avatar/`: `npm run voice:mics`, `npm run voice:mic-test`,
`npm run voice:capture-test` (4 record/stop cycles; FAILs if recordings accumulate).
The last recording is kept at `%TEMP%\avelyn-last-heard.wav`.

## Permissions

`--dangerously-skip-permissions` means her `avelyn-engine` tool calls run without approval prompts.
That's what makes a hands-free loop possible (headless `agy` can't prompt, it silently denies), but
it applies to *every* tool that session has, not just `avelyn-engine`.

## Tests

    node --no-warnings --test src/*.test.ts

whisper and agy are injected (`run` / `spawn` options) — neither needs to be installed to test.
