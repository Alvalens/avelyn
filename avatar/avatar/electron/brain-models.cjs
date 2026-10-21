const { exec } = require('node:child_process');

/**
 * The model dropdown in Settings → Brain, filled from each CLI where it can
 * say what it offers. Parsing is pure and tested; listModels does the I/O.
 */

/**
 * Claude Code has no list command. Its aliases always point at the latest
 * model of each tier, so they never go stale the way a pinned id would.
 */
const CLAUDE_MODELS = [
  { id: 'opus', label: 'Opus (latest)' },
  { id: 'sonnet', label: 'Sonnet (latest)' },
  { id: 'haiku', label: 'Haiku (latest)' },
];

function listCommandFor(provider) {
  if (provider === 'agy') return 'agy models';
  if (provider === 'codex') return 'codex debug models';
  return null;
}

/** `agy models`: a "Fetching…" banner, then "id<TAB>name" per line. */
function parseAgyModels(stdout) {
  return String(stdout)
    .split(/\r?\n/)
    .map((line) => line.split('\t'))
    .filter((parts) => parts.length >= 2 && parts[0].trim())
    .map(([id, label]) => ({ id: id.trim(), label: label.trim() }));
}

/** `codex debug models`: JSON. Hidden models are internal (reviewers, reserves). */
function parseCodexModels(stdout) {
  try {
    const { models } = JSON.parse(String(stdout));
    return (Array.isArray(models) ? models : [])
      .filter((m) => m && m.visibility !== 'hide' && typeof m.slug === 'string')
      .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
      .map((m) => ({ id: m.slug, label: m.display_name || m.slug }));
  } catch {
    return [];
  }
}

const cache = new Map();

/**
 * @returns {Promise<{ models: { id: string, label: string }[], error: string | null }>}
 * Run through a shell on purpose: this is a one-shot command whose output is
 * all that matters, so the shell resolving `.exe`/`.cmd` is a help, not the
 * orphaned-child problem it is for her long-lived session.
 */
function listModels(provider) {
  if (provider === 'claude') return Promise.resolve({ models: CLAUDE_MODELS, error: null });
  const command = listCommandFor(provider);
  if (!command) return Promise.resolve({ models: [], error: `unknown brain "${provider}"` });
  if (cache.has(provider)) return Promise.resolve(cache.get(provider));

  return new Promise((resolve) => {
    exec(command, { timeout: 30_000, windowsHide: true, maxBuffer: 64 * 1024 * 1024 }, (error, stdout) => {
      const models = provider === 'agy' ? parseAgyModels(stdout) : parseCodexModels(stdout);
      const result = {
        models,
        error: models.length > 0 ? null : `could not list models (${error ? error.message.split('\n')[0] : 'no output'})`,
      };
      // Only a good answer is kept: a CLI that was not logged in yet may be by the next look.
      if (models.length > 0) cache.set(provider, result);
      resolve(result);
    });
  });
}

module.exports = { CLAUDE_MODELS, listCommandFor, listModels, parseAgyModels, parseCodexModels };
