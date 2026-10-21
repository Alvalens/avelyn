import { useEffect, useState } from 'react';
import { micOptions, normalizeVoiceHud } from '../../config/voiceHud';
import { PanelSelect } from '../ui/PanelPrimitives';

/**
 * Settings → Voice input: push-to-talk (electron/voice-hud.cjs).
 *
 * @param {{
 *   settings: import('../../config/voiceHud').VoiceHudSettings,
 *   status: {
 *     hotkeyRegistered: boolean, pipeline: string, mic: string | null, mics?: string[],
 *     error: string | null,
 *   } | null,
 *   onChange: (next: import('../../config/voiceHud').VoiceHudSettings) => void,
 * }} props
 */
export function VoiceHudPanel({ settings, status, onChange }) {
  // Held as text while typed: a half-typed hotkey must not be registered.
  const [hotkeyDraft, setHotkeyDraft] = useState(settings.hotkey);

  useEffect(() => setHotkeyDraft(settings.hotkey), [settings.hotkey]);

  // The devices come from the bubble, which is the only window allowed to
  // open the mic (and so to see device names).
  const mic = micOptions(status?.mics, settings.micLabel);

  function commit(key, value) {
    const next = normalizeVoiceHud({ ...settings, [key]: value });
    if (key === 'hotkey') setHotkeyDraft(next.hotkey);
    if (next[key] !== settings[key]) onChange(next);
  }

  const blurOnEnter = (event) => {
    if (event.key === 'Enter') event.currentTarget.blur();
  };

  return (
    <div className="voice-hud-panel">
      <p className="panel-note panel-note--compact">
        Tap the hotkey and talk. Speech is transcribed on this machine and sent to her
        session (see Brain below); her reply shows in a bubble at the bottom of the screen.
      </p>

      <div className="desktop-toggle-row">
        <span className="settings-section-title">Push-to-talk</span>
        <input
          type="checkbox"
          className="panel-checkbox"
          checked={settings.enabled}
          onChange={() => onChange({ ...settings, enabled: !settings.enabled })}
        />
      </div>

      <p className="panel-note panel-note--compact">{describe(settings, status)}</p>

      <label className="field-label" htmlFor="voice-hud-hotkey">
        Hotkey
      </label>
      <input
        id="voice-hud-hotkey"
        className="field-input"
        type="text"
        value={hotkeyDraft}
        onChange={(event) => setHotkeyDraft(event.target.value)}
        onBlur={() => commit('hotkey', hotkeyDraft)}
        onKeyDown={blurOnEnter}
      />

      <label className="field-label" htmlFor="voice-hud-mic">
        Microphone
      </label>
      <PanelSelect
        id="voice-hud-mic"
        value={mic.value}
        options={mic.options}
        onChange={(value) => commit('micLabel', value)}
      />
      {settings.enabled && !status?.mics?.length ? (
        <p className="panel-note panel-note--compact">Looking for microphones…</p>
      ) : null}

      <div className="desktop-toggle-row">
        <span className="field-label">Stop when I stop talking</span>
        <input
          type="checkbox"
          className="panel-checkbox"
          checked={settings.autoStop}
          onChange={() => onChange({ ...settings, autoStop: !settings.autoStop })}
        />
      </div>
      <p className="panel-note panel-note--compact">
        {settings.autoStop
          ? 'Ends after about a second of quiet; tapping the hotkey still works.'
          : 'Tap the hotkey again to stop.'}{' '}
        Recordings are capped at 30 seconds.
      </p>
    </div>
  );
}

/**
 * @param {import('../../config/voiceHud').VoiceHudSettings} settings
 * @param {{ pipeline: string, mic: string | null, error: string | null } | null} status
 */
function describe(settings, status) {
  if (!settings.enabled) return 'Off. No hotkey, no microphone, no brain session.';
  if (status?.error) return status.error;
  if (!status || status.pipeline === 'starting') return 'Starting her session…';
  if (status.pipeline === 'restarting') return 'Her session stopped — restarting…';
  const mic = status.mic ? ` Listening on ${status.mic}.` : '';
  return `Press ${settings.hotkey} to talk.${mic}`;
}
