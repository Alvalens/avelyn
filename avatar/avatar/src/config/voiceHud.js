/**
 * Push-to-talk settings (the `voice` section of config.yaml), free of asset
 * imports so `node --test` can load it.
 *
 * Mirrored by normalizeVoiceSettings in electron/voice-hud-logic.cjs — main
 * checks an IPC payload itself rather than trusting the window's copy.
 */

/** Electron accelerator syntax. Keep in step with voice-hud-logic.cjs. */
export const defaultVoiceHotkey = 'Control+Alt+Space';

/** @typedef {{ enabled: boolean, hotkey: string, micLabel: string, autoStop: boolean }} VoiceHudSettings */

/** @returns {VoiceHudSettings} */
export function createDefaultVoiceHud() {
  return { enabled: true, hotkey: defaultVoiceHotkey, micLabel: '', autoStop: true };
}

/**
 * @param {unknown} raw
 * @returns {VoiceHudSettings}
 */
export function normalizeVoiceHud(raw) {
  const defaults = createDefaultVoiceHud();
  if (!raw || typeof raw !== 'object') return defaults;

  const data = /** @type {Record<string, unknown>} */ (raw);
  const hotkey = typeof data.hotkey === 'string' ? data.hotkey.trim() : '';
  return {
    // On by default — unlike the agent bus, this opens no port. Only a real
    // `false` turns it off.
    enabled: data.enabled !== false,
    hotkey: hotkey || defaultVoiceHotkey,
    // A case-insensitive fragment of the device name; empty = system default.
    micLabel: typeof data.micLabel === 'string' ? data.micLabel.trim() : '',
    // End the recording by itself once you stop talking; the hotkey still
    // stops it too. Only a real `false` turns it off.
    autoStop: data.autoStop !== false,
  };
}

// Chromium's aliases for whatever Windows currently routes to: the same
// physical device listed again, so they are folded into "Windows default".
const ALIAS = /^(Default|Communications) - /;
// The trailing USB vendor:product id is noise to a person picking a mic.
const USB_ID = /\s*\([0-9a-f]{4}:[0-9a-f]{4}\)$/i;

/**
 * The Settings microphone dropdown, from the labels the bubble reported.
 * Option values are full device labels: micLabel is matched as a substring,
 * so a full label selects exactly that device, and a fragment typed into
 * config.yaml by hand still resolves to the device it matches.
 *
 * @param {string[] | undefined} mics
 * @param {string} micLabel
 * @returns {{ options: { value: string, label: string }[], value: string }}
 */
export function micOptions(mics, micLabel) {
  const labels = Array.isArray(mics) ? mics : [];
  const systemDefault = labels.find((label) => label.startsWith('Default - '));
  const defaultName = systemDefault
    ?.replace(ALIAS, '')
    .replace(USB_ID, '')
    .match(/\((.*)\)$/)?.[1];

  const options = [
    { value: '', label: defaultName ? `Windows default (${defaultName})` : 'Windows default' },
    ...labels
      .filter((label) => !ALIAS.test(label))
      .map((label) => ({ value: label, label: label.replace(USB_ID, '') })),
  ];

  if (!micLabel) return { options, value: '' };
  const wanted = micLabel.toLowerCase();
  const match = options.find((option) => option.value && option.value.toLowerCase().includes(wanted));
  if (match) return { options, value: match.value };
  return { options: [...options, { value: micLabel, label: `${micLabel} (not connected)` }], value: micLabel };
}
