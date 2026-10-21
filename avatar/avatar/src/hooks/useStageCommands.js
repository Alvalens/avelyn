import { useCallback } from 'react';
import { defaultSkinId } from '../config/avatars';
import { resolveStageCommand } from '../lib/stageCommands';

/**
 * The only place a stage action is applied, so the multi-setter sequences below
 * exist once however the request arrived (Refs ARPAHLS/avatar#6).
 *
 * `runCommand` resolves and applies; `applyAction` applies something already
 * resolved, which is what the local bus needs — the main process validated the
 * request against the catalog this window reported, and only the action comes
 * back over IPC.
 *
 * @param {Object} args
 * @param {import('../lib/stageCommands').StageCommandContext} args.context
 * @param {{ selectedAvatarId: string }} args.current What is on stage now —
 * needed to tell a real change from a no-op.
 * @param {Object} args.setters The stage's own `useState` setters.
 * @returns {{
 *   runCommand: (command: string, payload?: unknown) =>
 *     import('../lib/stageCommands').StageCommandResult,
 *   applyAction: (action: import('../lib/stageCommands').StageAction) => void,
 * }}
 */
export function useStageCommands({ context, current, setters }) {
  const { selectedAvatarId } = current;
  const {
    setAnimationId,
    setAnimationRequest,
    setMotionOverlay,
    setAvatarReady,
    setSelectedAvatarId,
    setSelectedSkinId,
    setSelectedBg,
    setAudioSourceId,
    setVoicePlayback,
    setExpressionOverride,
  } = setters;

  const applyAction = useCallback(
    (action) => {
      switch (action?.kind) {
        case 'animation.play':
          if (action.mode === 'once' || action.mode === 'hold') {
            // Not `setAnimationId`: a one-shot leaves the menu selection, and
            // therefore config.yaml, untouched. The token is what fires the
            // same clip twice, which the id alone cannot ask for. `hold` is
            // the same overlay, told not to hand the stage back on its own.
            setMotionOverlay((overlay) => ({
              animationId: action.animationId,
              token: (overlay?.token ?? 0) + 1,
              hold: action.mode === 'hold',
            }));
            break;
          }

          // A deliberate pick outranks whatever gesture is mid-flight.
          setMotionOverlay(null);
          setAnimationId(action.animationId);
          // Re-selecting the clip already playing has to restart it, which the
          // id alone cannot express; VrmAvatar's effect keys off this counter.
          setAnimationRequest((count) => count + 1);
          break;

        case 'animation.stop':
          setMotionOverlay(null);
          break;

        case 'animation.release':
          // Only a held pose. If a gesture has since replaced it, that gesture
          // finishes on its own terms.
          setMotionOverlay((overlay) => (overlay?.hold ? null : overlay));
          break;

        case 'avatar.set': {
          // Only hide the stage when the model actually reloads. Re-selecting
          // the avatar already on it leaves modelPath alone, so VrmAvatar's
          // load effect never re-runs and `onLoaded` never fires.
          if (action.avatarId !== selectedAvatarId) {
            setAvatarReady(false);
          }
          setSelectedAvatarId(action.avatarId);
          setSelectedSkinId(defaultSkinId);
          break;
        }

        case 'environment.set':
          setSelectedBg(action.selection);
          break;

        case 'audio.source':
          setAudioSourceId(action.audioSourceId);
          break;

        case 'audio.play':
          // A fresh object every dispatch, so this always retriggers even if
          // the exact same clip somehow played twice in a row.
          setVoicePlayback({ buffer: action.buffer });
          break;

        case 'expression.set':
          // Independent of animation/avatar state on purpose: an external
          // caller pairs expression + animation with two calls, and neither
          // should clobber the other.
          setExpressionOverride({ id: action.expressionId, weight: action.weight });
          break;

        default:
          break;
      }
    },
    [
      selectedAvatarId,
      setAnimationId,
      setAnimationRequest,
      setMotionOverlay,
      setAvatarReady,
      setSelectedAvatarId,
      setSelectedSkinId,
      setSelectedBg,
      setAudioSourceId,
      setVoicePlayback,
      setExpressionOverride,
    ],
  );

  const runCommand = useCallback(
    (command, payload) => {
      const result = resolveStageCommand(command, payload, context);
      if (result.ok) applyAction(result.action);
      return result;
    },
    [context, applyAction],
  );

  return { runCommand, applyAction };
}
