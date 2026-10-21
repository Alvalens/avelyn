/**
 * Her brain (the `brain` section of config.yaml): which agent CLI runs her
 * session, and on which model. Free of asset imports so `node --test` can
 * load it.
 *
 * Mirrored by normalizeBrainSettings in electron/voice-hud-logic.cjs — main
 * checks an IPC payload itself rather than trusting the window's copy — and
 * read by ears/src/config.ts from the env the pipeline is started with.
 */

/** @typedef {'agy' | 'claude' | 'codex'} BrainProvider */
/** @typedef {{ provider: BrainProvider, model: string }} BrainSettings */

/** @type {{ id: BrainProvider, label: string }[]} */
export const brainProviders = [
  { id: 'agy', label: 'Antigravity (agy)' },
  { id: 'claude', label: 'Claude Code' },
  { id: 'codex', label: 'Codex' },
];

/** @returns {BrainSettings} */
export function createDefaultBrain() {
  return { provider: 'agy', model: '' };
}

/**
 * @param {unknown} raw
 * @returns {BrainSettings}
 */
export function normalizeBrain(raw) {
  if (!raw || typeof raw !== 'object') return createDefaultBrain();
  const data = /** @type {Record<string, unknown>} */ (raw);
  const provider = brainProviders.find((p) => p.id === data.provider)?.id;
  // A model only means something to the CLI it was picked for.
  if (!provider) return createDefaultBrain();
  return { provider, model: typeof data.model === 'string' ? data.model.trim() : '' };
}

/**
 * The model dropdown: "CLI default" (empty — whatever the CLI is set to use),
 * then the models the CLI listed. A model typed into config.yaml by hand that
 * the CLI did not list stays selectable rather than vanishing from the UI.
 *
 * @param {{ id: string, label: string }[] | undefined} listed
 * @param {string} current
 * @returns {{ value: string, label: string }[]}
 */
export function modelChoices(listed, current) {
  const models = Array.isArray(listed) ? listed : [];
  const choices = [{ value: '', label: 'CLI default' }, ...models.map((m) => ({ value: m.id, label: m.label }))];
  if (current && !models.some((m) => m.id === current)) choices.push({ value: current, label: current });
  return choices;
}
