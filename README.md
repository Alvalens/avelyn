# Avelyn

**Turn the AI subscription you already pay for into a desktop waifu.**

Avelyn is an anime companion who lives on your screen as an animated 3D avatar. You hold
a hotkey and talk; she answers out loud, in her own voice, with a subtitle bubble and a
gesture to match. She remembers what you tell her, can look at your screen when you ask,
and now and then says something without being asked — though mostly she's comfortable
with silence.

Her brain is the agent CLI you already have: **Claude Code**, **Codex**, or
**Antigravity (agy)**. No API keys, no extra bill: she runs on your existing subscription.
Pick the CLI and the model in Settings, and switch any time.

> Windows only. A just-for-fun project — expect rough edges.

## What she does

- **Talks with you.** Press **Ctrl+Alt+Space**, speak, pause. Your speech is transcribed
  on your machine (whisper.cpp); she replies in English as a subtitle and says it out loud
  in casual Japanese (VOICEVOX), lip-synced.
- **Reacts.** Expressions and gestures that fit the moment — mostly subtle, now and then
  not.
- **Remembers.** Durable facts about you and moments worth keeping, in a local SQLite
  database. She greets you with what she knows.
- **Looks, when asked.** "What do you think of this?" — she takes a screenshot and
  comments on what's actually there. She won't capture while a password manager, banking
  or private window is the one in front — but only the window in front is checked, so
  anything beside it or on another monitor is in the picture. Toggle it in Settings → Vision.
- **Speaks first, sometimes.** If you've been quiet a while she may say one line. Or not.
  Also a toggle.
- **Any brain.** Claude Code, Codex or agy, any model they offer — Settings → Brain. The
  default is agy; if the one picked isn't installed she uses one that is. The bubble shows
  which one she's on.

## How it fits together

```
 you ──hotkey──▶ avatar app (Electron) ──audio──▶ ears (whisper.cpp)
                      ▲                                │ transcript
                      │                                ▼
              avatar moves / speaks          her brain: claude | codex | agy
                      ▲                                │ tool calls
                      └──── local agent bus ◀── engine (MCP: react, speak, look, memory)
                                                       │
                                                  VOICEVOX (voice)
```

Everything runs locally except the model itself, which your CLI talks to as usual.

## Setup

You need: Windows, Node 24+, [VOICEVOX](https://voicevox.hiroshiba.jp/),
[whisper.cpp](https://github.com/ggml-org/whisper.cpp), and one of Claude Code, Codex or
Antigravity — logged in.

### The easy way: let your AI do it

Open your agent CLI in the cloned folder and say:

> Set up Avelyn for me.

The repo's `AGENTS.md` walks it through every step, and `Check-Avelyn.ps1` tells it what's
still missing. The one thing it can't do for you is log in to your CLI.

### By hand

```powershell
git clone https://github.com/Alvalens/avelyn.git
cd avelyn

# 1. Node 24+ and VOICEVOX
winget install OpenJS.NodeJS.LTS
winget install HiroshibaKazuyuki.VOICEVOX

# 2. Dependencies and the app build
cd avatar\avatar; npm install; npm run build; cd ..\..
cd engine; npm install; cd ..
```

3. **whisper.cpp:** download `whisper-bin-x64.zip` from the
   [releases](https://github.com/ggml-org/whisper.cpp/releases) and extract it into
   `%LOCALAPPDATA%\avelyn\whisper\bin` (so `bin\Release\whisper-cli.exe` exists). Download
   [`ggml-base.en.bin`](https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin)
   into `%LOCALAPPDATA%\avelyn\whisper\models\`.
4. **Your CLI:** install Claude Code, Codex or agy with its **native installer** (an npm-installed
   `.cmd` won't be found) and log in once by running it. Using agy? Register her tools with
   it — the checker prints the exact command.
5. Check, then start:

```powershell
.\Check-Avelyn.ps1     # lists anything missing, with the fix
.\Start-Avelyn.ps1     # VOICEVOX + the avatar app
```

Her first greeting takes up to half a minute while her brain warms up. Then press
**Ctrl+Alt+Space** and say hi.

## Using her

- **Settings → Brain** — which CLI she thinks with, and its model. Switching starts a new
  conversation (and a new greeting); her memories stay.
- **Settings → Voice input** — the hotkey, your microphone, stop-when-I-stop-talking.
- **Settings → Vision** — screenshots and speaking first, each a toggle.
- **Appearance** — background, and the folder her model is loaded from: drop in your own
  `.vrm` to change who's on stage.

### Make her yours

- **Personality:** `persona/AGENTS.md` is who she is — identity, speech style, boundaries.
  Edit it; the next session picks it up.
- **Voice:** any VOICEVOX speaker. Set the `VOICEVOX_SPEAKER_ID` environment variable, or
  put it in `engine/.env` (default 14, 冥鳴ひまり; `npm run cli -- speakers` in `voice/`
  lists them).
- **Gestures:** some reactions (listening, thinking, laughing…) are built from static
  poses. None ship with the repo — put a pack of `Pose NN.vrma` files in
  `avatar/animations/poses/` to enable them. Without one, she reacts with her face.

## Privacy

- Your voice is transcribed on your machine. The **text** goes to your CLI's model, like
  anything you type to it.
- Screenshots stay in `vision/captures/` (newest 50). One is sent to the model only when
  she opens it to answer you.
- Her memory is a local file, `memory/data/avelyn.db`.
- The app's local agent bus listens on `127.0.0.1` only, behind a token.
- **What her brain may do on your machine** depends on the CLI. Claude Code is limited to
  her own tools plus reading files; Codex runs in a read-only sandbox; **agy runs with
  every permission** (it has no finer switch). Text she reads on your screen reaches that
  session — with agy, prefer turning off "Let her look on her own" in Settings → Vision.

## Credits

Built on [ARPAHLS/avatar](https://github.com/ARPAHLS/avatar) (MIT). Voice by VOICEVOX
(`VOICEVOX:冥鳴ひまり`). Full list, with the terms for the bundled model and animations, in
[CREDITS.md](CREDITS.md).

## License

Code: [MIT](LICENSE). The Avelyn model and the bundled animations have their own terms —
see [CREDITS.md](CREDITS.md).
