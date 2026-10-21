import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createDefaultVoiceHud,
  defaultVoiceHotkey,
  micOptions,
  normalizeVoiceHud,
} from './voiceHud.js';

// Shaped like Chromium reports them (status.mics): aliases, virtual devices, USB ids.
const MICS = [
  'Default - Microphone (Desk USB Microphone) (1a2b:3c4d)',
  'Communications - Microphone (Desk USB Microphone) (1a2b:3c4d)',
  'Virtual Mic (Virtual Audio Cable)',
  'Line (2- Studio Interface) (5e6f:7a8b)',
  'Microphone (Desk USB Microphone) (1a2b:3c4d)',
];

test('normalizeVoiceHud reads a section it wrote', () => {
  const settings = {
    enabled: false, hotkey: 'Control+Shift+V', micLabel: 'Studio Interface', autoStop: false,
  };
  assert.deepEqual(normalizeVoiceHud(settings), settings);
});

test('stopping on silence is on unless explicitly turned off', () => {
  // A v5 file written before the option existed has no autoStop key.
  assert.equal(normalizeVoiceHud({ enabled: true }).autoStop, true);
  assert.equal(normalizeVoiceHud({ autoStop: 'false' }).autoStop, true);
  assert.equal(normalizeVoiceHud({ autoStop: false }).autoStop, false);
});

test('voice input is on unless a file explicitly turns it off', () => {
  // A config.yaml from before v5 has no section at all: that must mean "on",
  // since push-to-talk used to start with the HUD unconditionally.
  assert.deepEqual(normalizeVoiceHud(undefined), createDefaultVoiceHud());
  assert.deepEqual(normalizeVoiceHud('yes'), createDefaultVoiceHud());
  assert.equal(normalizeVoiceHud({}).enabled, true);
  assert.equal(normalizeVoiceHud({ enabled: 'false' }).enabled, true);
  assert.equal(normalizeVoiceHud({ enabled: false }).enabled, false);
});

test('a blank or non-string hotkey falls back to the default', () => {
  assert.equal(normalizeVoiceHud({ hotkey: '' }).hotkey, defaultVoiceHotkey);
  assert.equal(normalizeVoiceHud({ hotkey: '   ' }).hotkey, defaultVoiceHotkey);
  assert.equal(normalizeVoiceHud({ hotkey: 42 }).hotkey, defaultVoiceHotkey);
  assert.equal(normalizeVoiceHud({ hotkey: ' Alt+V ' }).hotkey, 'Alt+V');
});

test('micLabel is trimmed text; anything else means the system default', () => {
  assert.equal(normalizeVoiceHud({ micLabel: '  Realtek ' }).micLabel, 'Realtek');
  assert.equal(normalizeVoiceHud({ micLabel: null }).micLabel, '');
  assert.equal(normalizeVoiceHud({}).micLabel, '');
});

test('micOptions lists real devices once, after Windows default', () => {
  const { options } = micOptions(MICS, '');
  assert.deepEqual(options, [
    { value: '', label: 'Windows default (Desk USB Microphone)' },
    { value: MICS[2], label: 'Virtual Mic (Virtual Audio Cable)' },
    { value: MICS[3], label: 'Line (2- Studio Interface)' },
    { value: MICS[4], label: 'Microphone (Desk USB Microphone)' },
  ]);
});

test('micOptions selects the device a hand-typed fragment matches', () => {
  assert.equal(micOptions(MICS, '').value, '');
  assert.equal(micOptions(MICS, 'studio interface').value, MICS[3]);
  assert.equal(micOptions(MICS, MICS[4]).value, MICS[4]);
});

test('a configured mic that is not plugged in stays visible and selected', () => {
  // Dropping it would show "Windows default" while the bubble reports
  // "no mic matching" — the setting must say what config.yaml says.
  const { options, value } = micOptions(MICS, 'Yeti');
  assert.equal(value, 'Yeti');
  assert.deepEqual(options.at(-1), { value: 'Yeti', label: 'Yeti (not connected)' });
});

test('micOptions before the bubble has reported any devices', () => {
  assert.deepEqual(micOptions([], '').options, [{ value: '', label: 'Windows default' }]);
  assert.equal(micOptions(undefined, 'Desk').value, 'Desk');
});
