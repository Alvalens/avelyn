import { defaultColor } from './environmentSelection';

// Defined in an asset-free module; re-exported because this is where callers
// already look for anything environment-related.
export { defaultColor, normalizeEnvironmentSelection } from './environmentSelection';

/** @typedef {{ strong: string, soft: string, highlight: string }} HoloGlow */

/** Default lavender fade used for Color mode. */
export const defaultHoloGlow = {
  strong: 'rgba(210, 185, 255, 0.62)',
  soft: 'rgba(175, 145, 230, 0.28)',
  highlight: 'rgba(255, 255, 255, 0.14)',
};

const customGlow = {
  strong: 'rgba(190, 175, 230, 0.52)',
  soft: 'rgba(150, 130, 200, 0.24)',
  highlight: 'rgba(255, 255, 255, 0.12)',
};

/**
 * @typedef {Object} EnvironmentEntry
 * @property {string} id
 * @property {string} label
 * @property {string} src Bundled GIF URL (Vite-resolved), used by the stage
 * @property {string | null} [thumb] Still poster for the picker; falls back to `src`
 * @property {HoloGlow} glow
 * @property {boolean} [custom]
 * @property {boolean} [library] From a user-picked folder, so `src` is read on
 * demand rather than resolved by Vite — see lib/userLibrary.js
 */

// No bundled environments — the flat color fade (defaultColor) is the
// baseline. See customEnvironments below (or Settings → Directories) for
// anything more.
/** @type {EnvironmentEntry[]} */
export const environments = [];

const customModules = import.meta.glob('../assets/environments/custom/*.{gif,png,jpg,jpeg}', {
  eager: true,
  import: 'default',
});

/** @param {string} path */
function labelFromPath(path) {
  const file = path.split('/').pop() ?? path;
  const base = file.replace(/\.[^.]+$/, '');
  const cleaned = base.replace(/[_-]+/g, ' ').trim();
  if (cleaned.length > 18) return `${cleaned.slice(0, 16)}…`;
  return cleaned || 'Custom';
}

/** @type {EnvironmentEntry[]} */
export const customEnvironments = Object.entries(customModules)
  .map(([path, src]) => {
    const file = path.split('/').pop() ?? path;
    const id = `custom-${file.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '-')}`;
    return {
      id,
      label: labelFromPath(path),
      src: /** @type {string} */ (src),
      glow: customGlow,
      custom: true,
    };
  })
  .sort((a, b) => a.label.localeCompare(b.label));

/** Runtime custom envs from a user-picked folder (Electron). */
let libraryCustomEnvironments = /** @type {EnvironmentEntry[]} */ ([]);

/**
 * @param {EnvironmentEntry[]} entries
 */
export function setLibraryCustomEnvironments(entries) {
  libraryCustomEnvironments = Array.isArray(entries) ? entries : [];
}

/** @returns {EnvironmentEntry[]} */
export function getLibraryCustomEnvironments() {
  return libraryCustomEnvironments;
}

// A last-resort fallback for a stale selection (e.g. a config.yaml pointing at
// a bundled env id from before this build removed them, or a custom/library
// entry that no longer exists) — resolveHoloTheme still needs a glow/src pair
// to read, not undefined.
const fallbackEnvironment = { id: 'none', label: 'None', src: null, glow: defaultHoloGlow };

/** @param {string} id */
export function getEnvironmentById(id) {
  return (
    environments.find((entry) => entry.id === id) ??
    customEnvironments.find((entry) => entry.id === id) ??
    libraryCustomEnvironments.find((entry) => entry.id === id) ??
    environments[0] ??
    fallbackEnvironment
  );
}

/**
 * @typedef {import('./environmentSelection').EnvironmentSelection} EnvironmentSelection
 */

/**
 * @param {EnvironmentSelection} selection
 * @returns {{ glow: HoloGlow | null, imageUrl: string | null, hidden: boolean, pending: boolean }}
 */
export function resolveHoloTheme(selection) {
  if (selection.type === 'none') {
    return { glow: null, imageUrl: null, hidden: true, pending: false };
  }

  if (selection.type === 'env') {
    const env = getEnvironmentById(selection.id);
    // A custom-folder environment reads its bytes only once selected, which
    // takes as long as the file is big. `pending` separates that from the cases
    // that legitimately have no image, so the stage can hold what it is already
    // showing instead of blanking — see AvatarStageShell.
    return {
      glow: env.glow,
      imageUrl: env.src ?? null,
      hidden: false,
      pending: Boolean(env.library) && !env.src,
    };
  }

  const hex = selection.value.length === 4 ? defaultColor : selection.value;
  return { glow: glowFromHex(hex), imageUrl: null, hidden: false, pending: false };
}

/** @param {string} hex */
function glowFromHex(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return defaultHoloGlow;
  const { r, g, b } = rgb;
  return {
    strong: `rgba(${r}, ${g}, ${b}, 0.58)`,
    soft: `rgba(${r}, ${g}, ${b}, 0.26)`,
    highlight: 'rgba(255, 255, 255, 0.14)',
  };
}

/** @param {string} hex */
function hexToRgb(hex) {
  const normalized = hex.replace('#', '');
  if (normalized.length !== 6) return null;
  const value = Number.parseInt(normalized, 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}
