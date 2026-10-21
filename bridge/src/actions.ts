export type ExpressionId = 'happy' | 'angry' | 'sad' | 'relaxed' | 'surprised';

// Moods the voice can take that have no VRM face preset. VRM's expression set
// is fixed, so an action that reads as one of these on the face has to borrow
// the nearest preset while the voice takes the real mood — and that borrowing
// is audible: `shy_flustered` on `surprised`'s prosody sounded startled, not
// flustered, because the two are near-opposite shapes. Kept in sync with
// `voice/src/prosody.ts`'s Emotion union by engine's tools test, which asserts
// shy_flustered actually resolves to a `shy` voice mood.
export type VoiceOnlyEmotion = 'shy';
export type VoiceEmotion = ExpressionId | VoiceOnlyEmotion;

export interface PersonalityAction {
  id: string;
  description: string;
  expressionId: ExpressionId;
  weight?: number;
  animationId: string | null;
  /** Overrides `expressionId` for the *voice* only — see VoiceOnlyEmotion. */
  voiceEmotion?: VoiceEmotion;
}

// animationId either points at a real bundled/library clip, or at a named
// "Combo" entry (avatar/avatar/src/config/poseSequences.js) — a short, fixed
// sequence of static poses (from the Pose Library, hand-matched to what the
// pose actually looks like, not its filename) that plays as a one-shot
// gesture and holds on its last pose, same as a real VRMA clip would.
// Combo ids are hand-chosen and permanent, unlike the hash-based
// `lib-anim-<name>-<sha1>` ids a scanned folder produces — those hash the
// file's absolute path, so they differ on every clone. A scanned clip is
// named by its label instead (`greet` → 'Greeting', the file name), which
// the stage resolves after ids. Combos need the Pose Library, which is not
// redistributed: without it runAction falls back to the expression alone.
// annoyed/scold/surprised_reaction/concerned have no strong pose match yet
// and stay expression-only (animationId: null).
//
// idle_calm is expression-only for a different reason: "composed resting
// stance" is the ambient idle *itself*, not a reaction to anything, so moving
// the body for it is a contradiction. It used to point at `combo-idle-calm`,
// which is a single-pose combo — 0.7s into Pose 04, ~0.45s held, then
// reverted — and Pose 04 is already in the Pose Cycle's pool, so it read as
// the avatar twitching to a pose she was about to drift into anyway and then
// jerking back out. Starting that overlay also bumped the shared
// `requestGeneration` (useVrmAnimation.js), killing the cycle's pending
// advance timer and restarting the ambient idle from a fresh shuffle. It is
// still selectable by hand from the animation menu; it just isn't something
// she should reach for as a reaction.
export const personalityActions: PersonalityAction[] = [
  { id: 'greet', description: 'Greeting the user', expressionId: 'happy', animationId: 'Greeting' },
  { id: 'idle_calm', description: 'Composed resting stance', expressionId: 'relaxed', animationId: null },
  { id: 'think', description: 'Considering something / processing', expressionId: 'relaxed', animationId: 'combo-think' },
  { id: 'tsun_deny', description: "Tsundere refusal (\"it's not like...\")", expressionId: 'angry', animationId: 'combo-tsun-deny' },
  { id: 'annoyed', description: 'Mildly fed up / exasperated', expressionId: 'angry', weight: 0.8, animationId: null },
  { id: 'scold', description: 'Lecturing / calling the user out', expressionId: 'angry', animationId: null },
  { id: 'pleased', description: 'Quietly satisfied / smug approval', expressionId: 'happy', weight: 0.7, animationId: 'combo-pleased' },
  { id: 'surprised_reaction', description: 'Caught off guard', expressionId: 'surprised', animationId: null },
  { id: 'laugh', description: 'Genuine amusement', expressionId: 'happy', animationId: 'combo-laugh' },
  { id: 'concerned', description: 'Worried about the user', expressionId: 'sad', animationId: null },
  { id: 'shy_flustered', description: 'Caught being sincere, flustered', expressionId: 'surprised', weight: 0.8, voiceEmotion: 'shy', animationId: 'combo-shy-flustered' },
];

export function getAction(id: string): PersonalityAction | undefined {
  return personalityActions.find((action) => action.id === id);
}
