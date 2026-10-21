const { contextBridge, ipcRenderer } = require('electron');

// Passed as a process argument by main; see `additionalArguments` there.
const micArg = process.argv.find((arg) => arg.startsWith('--avelyn-mic=')) || '';
const micLabel = micArg.slice('--avelyn-mic='.length);

// No `nodeIntegration`, so this is the renderer's entire view of the world:
// it draws what it is told, opens the microphone, and hands back audio.
contextBridge.exposeInMainWorld('hud', {
  micLabel,
  autoStop: process.argv.includes('--avelyn-auto-stop'),
  micTest: process.argv.includes('--avelyn-mic-test'),
  captureTest: process.argv.includes('--avelyn-capture-test'),
  onState: (handler) => ipcRenderer.on('hud:state', (_event, state) => handler(state)),
  // Which brain and model she is running on, for the corner of the bubble.
  onBrain: (handler) => ipcRenderer.on('hud:brain', (_event, brain) => handler(brain)),
  onStartRecording: (handler) => ipcRenderer.on('hud:start-recording', () => handler()),
  onStopRecording: (handler) => ipcRenderer.on('hud:stop-recording', () => handler()),
  sendPcm: (buffer, sampleRate, levels) =>
    ipcRenderer.send('hud:pcm', buffer, sampleRate, levels),
  noMic: (message) => ipcRenderer.send('hud:no-mic', message),
  discarded: () => ipcRenderer.send('hud:discarded'),
  autoStopped: (reason) => ipcRenderer.send('hud:auto-stop', reason),
  resize: (height) => ipcRenderer.send('hud:resize', height),
  reportMics: (devices) => ipcRenderer.send('hud:mics', devices),
  reportMicTest: (result) => ipcRenderer.send('hud:mic-test', result),
  reportCaptureTest: (result) => ipcRenderer.send('hud:capture-test', result),
});
