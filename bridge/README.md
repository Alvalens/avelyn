# bridge

Talks to `avatar/`'s local agent bus (`POST http://127.0.0.1:47903/v1/command`) to drive Avelyn's
expressions and animations. Composes her personality actions (e.g. `greet` = happy + wave) as two independent
agent-bus calls per action — `expression.set` then `animation.play`, when there's a matching clip —
same as they behave in the app itself: neither call clobbers the other.

Plain TypeScript, run directly by Node 24 (native type stripping) — no build step, no npm
install needed.

## Setup

Nothing to configure: with the avatar app running, the bus address and token are read from
the runtime file the app keeps (`%LOCALAPPDATA%\avelyn\runtime.json`, see `src/runtime.ts`).
The bus is on by default (Settings → Agents). A `.env` (from `.env.example`) is optional, to
point somewhere else.

## Use

    npm run cli -- list                     # print every action id
    npm run cli -- greet                    # run one action

    npm run server                          # start the HTTP wrapper (default port 4790)
    curl -X POST http://127.0.0.1:4790/actions/greet
    curl http://127.0.0.1:4790/actions      # list the catalog as JSON

## Action map

`src/actions.ts` — one entry per personality action: `expressionId` (+ optional `weight`, defaults
to 1) and `animationId` (an AVATAR animation catalog id, or `null` for expression-only).

`voiceEmotion` (optional) overrides `expressionId` for the **voice** only. It exists because VRM's
face presets are a fixed set — an action whose face has to borrow the nearest preset can still have
its own spoken mood, and the difference is audible: `shy_flustered` on `surprised`'s prosody sounded
startled rather than flustered. Only voice-only moods go here (`VoiceOnlyEmotion`, currently just
`shy`), since anything in the shared vocabulary is already expressible via `expressionId`.
`engine/`'s tools test asserts the wiring resolves, which is what keeps this in sync with
`voice/src/prosody.ts`'s `Emotion` union.

**"Default" for animations now means `<repo>\avatar\animations`** — the folder that sits beside
the app, resolved at startup — not the bundled VRMA pack, which is only the fallback for an install
that has no such folder. Setting a *custom* animations folder (`directories.animations` in `config.yaml`) replaces it outright,
for previewing a pack before adopting it. Either way each clip is scanned into a hashed
`lib-anim-<name>-<sha1-of-absolute-path>` id.

    animations/
      Show Full Body.vrma  Greeting.vrma  Peace Sign.vrma  Shoot.vrma
      Spin.vrma  Model Pose.vrma  Squat.vrma
      Idle Standing Wait.vrma   # free animation from BOOTH
      poses/                    # optional pose pack (not included): Pose NN.vrma + mirrors
        Pose 01.vrma  Pose 01 Mirror.vrma  ...  Pose 15 Mirror.vrma

The scan is recursive, and **a subfolder means "building blocks"**: those 30 poses stay fully
addressable by id (the Combos resolve them, and `animation.play` can still name one) but are left
out of the Animations menu, which would otherwise be 30 rows of raw pose. Only root-level clips are
listed. The subfolder name also becomes the group heading for anything it does list.

On top of that folder scan, AVATAR builds two kinds of **synthetic** catalog entries, resolved by
label against whatever the folder actually contains rather than hardcoded. They are appended in
both default and custom mode, so the Combos are always in the menu when the poses behind them are
present:

- **Pose Cycle** (`avatar/avatar/src/config/poseCycle.js`) — an ambient idle: a shuffled walk
  through a curated pool of the static poses, reshuffled every full pass, each held for a jittered
  duration before crossfading to the next. Not used by any personality action; it's a background
  idle option, selectable from the Animations menu.
- **Combo `*`** (`avatar/avatar/src/config/poseSequences.js`) — named, hand-matched (by actually
  looking at what each pose depicts, not its filename), *ordered* short combinations of poses that
  play once as a real gesture and hold on the last pose — e.g. `combo-shy-flustered` is
  touch-chest → clasp-hands → fidget-with-collar, not one raw pose on loop. Unlike scanned-folder
  ids, **combo ids are hand-chosen and permanent** (not a path hash), so they don't need updating
  if the folder is rescanned.

Poses inside a combo are blended on a cubic-Bézier curve (`avatar/avatar/src/lib/easing.js`) rather
than a linear weight ramp, and the two weights always sum to 1 — three.js fills any unclaimed
weight with the **bind pose**, so a blend that dips below 1 flashes a T-pose. A clip with nothing to
fade *from* snaps to full weight for the same reason.

Marking an animation as an idle — right-click it in the Animations menu — puts it in an **idle
pool** (`idlePool` in config.yaml). When a one-shot finishes, whether a bridge gesture or a Combo
picked by hand, the stage returns to a random pool member rather than holding the last pose. An
empty pool keeps the old behaviour: whatever is selected just keeps playing.

Current matches: `greet` (Greeting, a real clip), `think` (`combo-think`), `tsun_deny`
(`combo-tsun-deny`), `laugh` (`combo-laugh`), `shy_flustered` (`combo-shy-flustered`), `pleased`
(`combo-pleased` — composed stance settling into a finger-raised smirk, Pose 12 → Pose 15).
`annoyed`/`scold`/`surprised_reaction`/`concerned` have no strong pose match and stay
expression-only. So does `idle_calm`, for a different reason: "composed resting stance" *is* the
ambient idle, so moving the body for it contradicts itself. It used to point at `combo-idle-calm`
— a **single-pose** combo (0.7s fading into Pose 04, ~0.45s held, then reverted), and Pose 04 is
already in the Pose Cycle's pool, so it read as a twitch into a pose she was about to drift into
anyway and then a jerk back out. Starting that overlay also bumped the shared `requestGeneration`
(`useVrmAnimation.js`), killing the cycle's pending advance timer — the ambient idle restarted from
a fresh shuffle rather than continuing. `combo-idle-calm` is still selectable by hand from the
menu; it just isn't something the agent should reach for as a reaction. `combo-listening` (Pose 03, a hand-near-ear attentive
stance) exists in the catalog and menu but isn't wired to any action either — nothing unmatched
reads as "listening," so it's left as a menu-only option rather than forced onto a bad fit.
`greet` names its clip by **label** (`'Greeting'`, the file name): a scanned clip's id hashes
its absolute path and differs on every clone, and the stage resolves labels after ids. Combos
need the pose pack; when the stage answers `unknown-animation`, the action falls back to its
expression and still succeeds. Edit the array directly — it's a plain object, no schema or
migration to worry about.

## Tests

    node --test src/*.test.ts

Fetch is mocked in every test — the AVATAR app doesn't need to be running.
