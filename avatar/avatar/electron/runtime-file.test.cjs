const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { busEntry, runtimePath, updateRuntime } = require('./runtime-file.cjs');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avelyn-runtime-app-'));

test('same location the Node side reads (bridge/src/runtime.ts)', () => {
  assert.equal(runtimePath({ LOCALAPPDATA: 'C:\\L' }), path.join('C:\\L', 'avelyn', 'runtime.json'));
  assert.equal(runtimePath({ LOCALAPPDATA: 'C:\\L', AVELYN_RUNTIME: 'D:\\r.json' }), 'D:\\r.json');
});

test('each update touches only its own section, and creates the folder on first write', () => {
  const file = path.join(dir, 'nested', 'runtime.json');
  updateRuntime({ vision: { enabled: true } }, file);
  updateRuntime({ bus: { url: 'http://127.0.0.1:1', token: 't' } }, file);
  updateRuntime({ vision: { enabled: false } }, file);

  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), {
    vision: { enabled: false },
    bus: { url: 'http://127.0.0.1:1', token: 't' },
  });
});

test('a broken file is replaced rather than blocking every later write', () => {
  const file = path.join(dir, 'broken.json');
  fs.writeFileSync(file, '{ nope');
  updateRuntime({ bus: null }, file);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { bus: null });
});

test('busEntry: the address and token she needs, or null while the bus is off', () => {
  assert.deepEqual(busEntry({ running: true, port: 47903, token: 'abc' }), { url: 'http://127.0.0.1:47903', token: 'abc' });
  assert.deepEqual(busEntry({ running: true, port: 47903, token: null }), { url: 'http://127.0.0.1:47903', token: null });
  assert.equal(busEntry({ running: false, port: 47903, token: 'abc' }), null);
});
