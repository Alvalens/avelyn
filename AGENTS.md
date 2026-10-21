# Avelyn — guide for coding agents

You are working **on** Avelyn, a desktop AI companion: an animated VRM avatar that
talks back out loud, driven by an agent CLI (Antigravity `agy`, Claude Code, or Codex).

**You are not Avelyn.** Her persona is `persona/AGENTS.md`. It is copied into her own
working folder (`%LOCALAPPDATA%\avelyn\home`) when she starts, and only her session reads
it. Do not adopt it, and do not move it back to the repo root.

Windows only.

## Setting it up for the user

When asked to set this repo up, go through these steps in order. After each one, run the
checker and keep going until it reports no `[missing]` lines:

```powershell
.\Check-Avelyn.ps1      # exit code 0 = ready, 1 = something is missing (it says what and how to fix it)
```

1. **Node 24 or newer.** `winget install OpenJS.NodeJS.LTS`, if `node --version` is older or
   missing.
2. **Dependencies and the app build:**
   ```powershell
   cd avatar\avatar; npm install; npm run build; cd ..\..
   cd engine; npm install; cd ..
   ```
   The other packages (`bridge`, `memory`, `voice`, `vision`, `ears`) have no dependencies.
3. **VOICEVOX** (her voice, a local Japanese TTS engine): `winget install HiroshibaKazuyuki.VOICEVOX`.
4. **whisper.cpp** (her ears, local speech-to-text, English):
   - Download `whisper-bin-x64.zip` from https://github.com/ggml-org/whisper.cpp/releases
     and extract it into `%LOCALAPPDATA%\avelyn\whisper\bin`, so that
     `%LOCALAPPDATA%\avelyn\whisper\bin\Release\whisper-cli.exe` exists.
   - Download https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin
     to `%LOCALAPPDATA%\avelyn\whisper\models\ggml-base.en.bin`.
5. **An agent CLI for her brain.** The user needs at least one they have a subscription for.
   You are probably running in one already: use that one. Each must be logged in once,
   **by the user**: they run it in a terminal (`claude`, then `/login`; `codex login`; `agy`).
   Do not try to log in for them.
6. **agy only:** register her tools with agy. The checker prints the exact command for
   this repo's path:
   `agy mcp add avelyn-engine node -- --no-warnings "<repo>\engine\src\server.ts"`.
   Claude Code and Codex need no registration: she passes her tools to them on every launch.
7. Run `.\Check-Avelyn.ps1` again. When it passes, start her with `.\Start-Avelyn.ps1`.

**Things only the user does:** logging in to their CLI, and choosing which one she uses
(in the avatar app: **Settings → Brain**, which also picks the model). Tell them the
hotkey: **Ctrl+Alt+Space** opens the mic; she replies out loud. Her first greeting takes
up to half a minute while her brain warms up.

**Optional:** gestures built from poses (listening, thinking, laughing…) need a pose pack
of `Pose NN.vrma` files in `avatar/animations/poses/`. None ships with the repo. Without
one she reacts with her face instead.

## Layout

| Folder | What it is |
|---|---|
| `avatar/avatar/` | The Electron app: transparent overlay, VRM rendering, push-to-talk bubble, Settings, local agent bus (`127.0.0.1:47903`). A fork of [ARPAHLS/avatar](https://github.com/ARPAHLS/avatar). |
| `avatar/model/` | `Avelyn.vrm`, the default character. |
| `avatar/animations/` | Default animation clips (VRoid motion pack, idle). |
| `ears/` | Push-to-talk pipeline: whisper transcription, and her brain session (`src/brain/`: one adapter per CLI). |
| `engine/` | MCP server with her tools (`react`, `speak`, `look`, memory). Every brain is given it. |
| `bridge/` | Personality actions (expression + gesture), and the client for the app's agent bus. |
| `memory/` | SQLite/FTS5 memory: durable facts and episodes. |
| `voice/` | VOICEVOX client. |
| `vision/` | Screenshots for `look`, with a blocklist. |
| `persona/` | Her persona. |

Where things live at runtime: app settings in `%APPDATA%\avatar\config.yaml`. The app
publishes the bus address, its token and the vision settings in
`%LOCALAPPDATA%\avelyn\runtime.json`, which the Node side reads; no `.env` file is needed.
Her memory is in `memory/data/avelyn.db` and her screenshots in `vision/captures/` (both
git-ignored).

## Working on the code

- The TypeScript packages run directly on Node 24 (native type stripping): no build step, no
  bundler. Tests are `node:test`: `npm test` in each package folder, and in
  `avatar/avatar` (which also has `npm run build`).
- The engine imports `bridge/`, `memory/`, `voice/` and `vision/` as source. An edit there
  reaches her only in a newly started session (restart the avatar app, or switch brains).
- Comments explain *why*, often with what was observed live. Keep that up.
