const fs = require('node:fs');
const path = require('node:path');

/**
 * The runtime file: what this app tells the Node 24 side (the engine her
 * brain spawns, and the push-to-talk pipeline) — where the agent bus is, its
 * token, and the vision settings. Read by bridge/src/runtime.ts; keep the
 * location in step with runtimePath there.
 *
 * It replaces copying the bus token into engine/.env by hand, and the old
 * vision/settings.json mirror inside the repo. The token is in plain text, in
 * the user's own profile — the exposure engine/.env already had.
 */
function runtimePath(env = process.env) {
  if (env.AVELYN_RUNTIME && env.AVELYN_RUNTIME.trim()) return env.AVELYN_RUNTIME;
  const local = env.LOCALAPPDATA || path.join(env.USERPROFILE || env.HOME || '', 'AppData', 'Local');
  return path.join(local, 'avelyn', 'runtime.json');
}

function readRuntime(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

/** Merge one section in. Written whole and renamed into place, so a reader never sees half a file. */
function updateRuntime(patch, file = runtimePath()) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const next = { ...readRuntime(file), ...patch };
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
    fs.renameSync(tmp, file);
  } catch (error) {
    console.error('[runtime] could not write', file, error.message);
  }
}

/** The bus as she should reach it — null while it is off, so she can say why she can't. */
function busEntry({ running, port, token }) {
  return running ? { url: `http://127.0.0.1:${port}`, token: token ?? null } : null;
}

module.exports = { busEntry, readRuntime, runtimePath, updateRuntime };
