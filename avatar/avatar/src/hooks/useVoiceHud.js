import { useEffect, useMemo, useState } from 'react';
import { getVoiceHudApi } from '../lib/desktopMode';

/**
 * The window's half of push-to-talk: tells main what config.yaml says, and
 * listens for status, which can change on its own (a hotkey that fails to
 * register, a pipeline restarting). Same shape as useAgentBus.
 *
 * @param {{
 *   settings: import('../config/voiceHud').VoiceHudSettings,
 *   vision: import('../config/vision').VisionSettings,
 *   brain: import('../config/brain').BrainSettings,
 *   ready: boolean,
 * }} args
 * `ready` is false until config.yaml has been read — starting before then
 * would spin up agy on the defaults, then restart it with the user's mic.
 */
export function useVoiceHud({ settings, vision, brain, ready }) {
  const api = useMemo(() => getVoiceHudApi(), []);
  const [status, setStatus] = useState(null);
  const { enabled, hotkey, micLabel, autoStop } = settings;
  // An object in the deps would re-run the effect every render.
  const visionKey = JSON.stringify(vision ?? null);
  const { provider, model } = brain;

  useEffect(() => {
    if (!api || !ready) return undefined;
    let cancelled = false;
    void api
      .configure({ enabled, hotkey, micLabel, autoStop, vision: JSON.parse(visionKey), brain: { provider, model } })
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch(() => {
        if (!cancelled) setStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, [api, ready, enabled, hotkey, micLabel, autoStop, visionKey, provider, model]);

  useEffect(() => {
    if (!api) return undefined;
    return api.onStatus(setStatus);
  }, [api]);

  /** What the chosen CLI says it can run, for the model dropdown. */
  const listModels = (wanted) => (api?.models ? api.models(wanted) : Promise.resolve({ models: [], error: null }));

  return { status, listModels };
}
