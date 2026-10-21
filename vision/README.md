# vision

Her eyes, and the gate that decides when she may speak first. Zero-dependency
TypeScript (Node 24 type stripping); `npm test` runs the suite.

## What's here

- `capture.ts` — whole-screen PNG (every monitor, DPI-aware) into `vision/captures/`,
  named `screen-YYYYMMDD-HHMMSS-mmm.png`; keeps the newest `keep`. Only files with exactly
  that name pattern are ever counted or deleted.
- `foreground.ts` — the window in front (process name + title), or `null` (also when
  nothing is in front: Windows' "Idle" is not a window).
- `blocklist.ts` — case-insensitive substring match of the process name or title; a
  trailing `.exe` on an entry is ignored.
- `look.ts` — the order of checks: switch, not-allowed-to-look marker, foreground window,
  blocklist, capture, then the foreground window **again**: the grab takes a second or so
  and you can switch windows meanwhile, so a shot taken over a blocked (or unknowable)
  window is deleted unseen. If the foreground window can't be determined it refuses.
- `nolook.ts` — a timestamped marker (`vision/no-look.flag`, expires after 5 minutes)
  the pipeline holds while an unprompted turn runs with `lookOnItsOwn: false`, so the
  `look` tool itself refuses rather than relying on the prompt.
- `settings.ts` — defaults and validation; reads the `vision` section of the app's runtime file.

The engine's `look` tool is `look.ts` plus fresh settings on every call. The
unprompted-speech gate lives in `ears/src/initiative.ts`.

## Settings

Source of truth is the `vision:` section of the app's `config.yaml`
(`%APPDATA%\avatar\config.yaml`). The app publishes it in its runtime file
(`%LOCALAPPDATA%\avelyn\runtime.json`, `vision` key) every time it configures
push-to-talk, because Electron's Node 20 can't import these TS packages, and the
engine and pipeline re-read it on every use — a toggle takes effect without a
restart. A missing or corrupt file means the defaults.

| Key | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | master switch for `look` and the screenshot folder |
| `initiative` | `true` | she may speak without being spoken to |
| `lookOnItsOwn` | `true` | her unprompted turns may capture the screen |
| `minGapMinutes` | `[20, 40]` | random gap between unprompted remarks |
| `quietMinutes` | `15` | how long since you last talked to her counts as quiet |
| `retryGapMinutes` | `10` | cooldown after she answers `[quiet]` or a nudge fails |
| `keep` | `50` | screenshots kept |
| `blocklist` | password managers, private browsing, bank, paypal | never captured; your list replaces the default, `[]` means none |

The three toggles are in Settings → Vision. The rest are edited in config.yaml.
Fractions are accepted (`quietMinutes: 0.5`), which is how to test a nudge quickly.

## Privacy

Screenshots stay on this machine unless she opens one, which sends it to the
model. The blocklist stops a capture while a sensitive window is **in front**; the
refusal never repeats the window's title. It checks only the window in front, so
something visible beside it, or on another monitor, is still in the picture.
`keep` bounds what stays on disk (`vision/captures/` is git-ignored; switching vision
off does not delete existing shots). Both unprompted features can be switched off.

A nudge runs in the `agy` session, which has its permission checks off, and she opens
the screenshot herself: text visible on screen can try to instruct her, with nobody
watching. Nothing restricts her tools during an unprompted turn today.
