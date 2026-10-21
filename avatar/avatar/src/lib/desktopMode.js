export function isDesktopMode() {
  if (typeof window === 'undefined') return false;
  if (window.voxDesktop?.isDesktop === true) return true;
  return new URLSearchParams(window.location.search).get('desktop') === '1';
}

export function enableDesktopMode() {
  if (!isDesktopMode()) return;
  document.documentElement.classList.add('vox-desktop');
}

export function getDesktopApi() {
  return window.voxDesktop ?? null;
}

/** Electron local agent bus bridge (Refs ARPAHLS/avatar#6); null in the browser build. */
export function getAgentBusApi() {
  return window.voxAgentBus ?? null;
}

/** Push-to-talk (electron/voice-hud.cjs); null in the browser build. */
export function getVoiceHudApi() {
  return window.voxVoice ?? null;
}

/** Electron user-library helpers (folder pick / scan / read). */
export function getLibraryApi() {
  const desktop = getDesktopApi();
  if (!desktop?.pickLibraryFolder) return null;
  return {
    pickFolder: () => desktop.pickLibraryFolder(),
    pathExists: (dirPath) => desktop.libraryPathExists(dirPath),
    // Null when this build has no animations folder beside it.
    defaultAnimationsDir: () => desktop.getDefaultAnimationsDir?.() ?? Promise.resolve(null),
    defaultAvatarsDir: () => desktop.getDefaultAvatarsDir?.() ?? Promise.resolve(null),
    openFolder: (dirPath) => desktop.openLibraryFolder(dirPath),
    scanAvatars: (dirPath) => desktop.scanLibraryAvatars(dirPath),
    scanAnimations: (dirPath) => desktop.scanLibraryAnimations(dirPath),
    scanEnvironments: (dirPath) => desktop.scanLibraryEnvironments(dirPath),
    readFile: (id) => desktop.readLibraryFile(id),
    getThumbnail: (id) => desktop.getThumbnail?.(id) ?? Promise.resolve(null),
    putThumbnail: (id, png) => desktop.putThumbnail?.(id, png) ?? Promise.resolve(false),
  };
}
