const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

// voice-hud.cjs needs Electron to run, so no test can load it. A syntax error
// in it would only show when the app starts — and push-to-talk would silently
// not exist. Parsing it (without running it) is the cheapest check that works.

/** Compile as Node wraps a CommonJS module; throws on a syntax error. */
function compiles(source, filename) {
  new vm.Script(
    `(function (exports, require, module, __filename, __dirname) {${source}\n})`,
    { filename },
  );
}

test('voice-hud.cjs parses', () => {
  const file = path.join(__dirname, 'voice-hud.cjs');
  assert.doesNotThrow(() => compiles(fs.readFileSync(file, 'utf8'), file));
});

test('the parse check does catch a string broken across lines', () => {
  assert.throws(() => compiles("const a = 'one\ntwo';", 'broken.cjs'), SyntaxError);
});
