import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import {
  animationCatalog as bundledAnimations,
  defaultAnimationId,
  findAnimation,
  resolveAnimationId,
} from '../config/animations';
import { getAudioSourceOptions, getDefaultAudioSourceId } from '../config/audioSources';
import {
  defaultLipSyncMouthStrength,
  defaultLipSyncSensitivity,
} from '../config/lipSyncSensitivity';
import { defaultIdleBreathingIntensity } from '../config/idleBreathing';
import { createDefaultIdlePool, pickIdleAnimation, toggleIdlePool } from '../config/idlePool';
import { buildPoseCycleEntry, defaultPoseCycleHoldSeconds } from '../config/poseCycle';
import { buildPoseSequenceEntries } from '../config/poseSequences';
import {
  customEnvironments,
  defaultColor,
  environments,
  setLibraryCustomEnvironments,
} from '../config/environments';
import {
  avatars as bundledAvatars,
  defaultAvatarId,
  defaultSkinId,
  resolveAvatarPath,
} from '../config/avatars';
import { createDefaultAgentBus } from '../config/agentBus';
import { createDefaultVoiceHud } from '../config/voiceHud';
import { createDefaultVision } from '../config/vision';
import { createDefaultBrain } from '../config/brain';
import { defaultAvatar, defaultCamera, defaultLight, STAGE } from '../config/defaults';
import { defaultWindowScale, normalizeWindowScale } from '../config/windowScale';
import {
  createDefaultDirectories,
  createDefaultDirectorySource,
  createDefaultUserSettings,
  snapshotUserSettings,
} from '../config/userSettings';
import { useAudioSource } from '../hooks/useAudioSource';
import { useVoicePlayback } from '../hooks/useVoicePlayback';
import { useAgentBus } from '../hooks/useAgentBus';
import { useVoiceHud } from '../hooks/useVoiceHud';
import { useStageCommands } from '../hooks/useStageCommands';
import { getDesktopApi, getLibraryApi, isDesktopMode } from '../lib/desktopMode';
import { isPlayableOnce } from '../lib/stageCommands';
import {
  loadEnvironmentSource,
  loadLibraryAnimations,
  loadLibraryAvatars,
  loadLibraryEnvironments,
  revokeAnimationBlobUrls,
  revokeAvatarBlobUrls,
  revokeEnvironmentBlobUrls,
} from '../lib/userLibrary';
import { loadUserSettings, resetUserSettings, saveUserSettings } from '../lib/userSettingsStore';
import { revokeThumbnailUrls } from '../lib/thumbnails';
import { revokeEnvironmentThumbnailUrls } from '../lib/environmentThumbnails';
import { resolveLiveDotMode } from '../lib/liveDot';
import { VrmAvatar } from './avatar/VrmAvatar';
import { AvatarStageShell } from './avatar/AvatarStageShell';
import { CameraController } from './ui/CameraController';
import { GlassDrawer } from './ui/GlassDrawer';
import { Divider } from './ui/PanelPrimitives';
import { PalettePanel } from './panels/PalettePanel';
import { VoicePanel } from './panels/VoicePanel';
import { CameraPanel } from './panels/CameraPanel';
import { DesktopPanel } from './panels/DesktopPanel';
import { AgentBusPanel } from './panels/AgentBusPanel';
import { VoiceHudPanel } from './panels/VoiceHudPanel';
import { VisionPanel } from './panels/VisionPanel';
import { BrainPanel } from './panels/BrainPanel';
// Motion Deck (ARPAHLS/avatar#24). Held here only because it is persisted with the rest of
// the settings; everything else about it is in src/motion-deck/.
import { createEmptyDeck } from '../motion-deck/motionDeck';
import { useMotionDeck } from '../motion-deck/useMotionDeck';

const desktopMode = isDesktopMode();
const SAVE_DEBOUNCE_MS = 400;

export function AvatarStage() {
  const [settingsReady, setSettingsReady] = useState(false);
  const [animationId, setAnimationId] = useState(defaultAnimationId);
  const [animationRequest, setAnimationRequest] = useState(0);
  // Animations the user right-clicked "Set as idle" on. Empty = the old
  // behaviour, where whatever is selected just keeps playing.
  const [idlePool, setIdlePool] = useState(createDefaultIdlePool);
  // The animations folder that ships beside the app, resolved once at startup.
  // Null in the browser build, or if this install has no folder next to it.
  const [defaultAnimationsDir, setDefaultAnimationsDir] = useState(null);
  const [defaultAvatarsDir, setDefaultAvatarsDir] = useState(null);
  const [defaultAnimationsDirReady, setDefaultAnimationsDirReady] = useState(!desktopMode);
  // A one-shot on top of the selection above. Never persisted: `animationId` is
  // what config.yaml stores, and a gesture must not overwrite it.
  const [motionOverlay, setMotionOverlay] = useState(null);
  const [camera, setCamera] = useState({ ...defaultCamera });
  const [light, setLight] = useState({ ...defaultLight });
  const [avatar, setAvatar] = useState({ ...defaultAvatar });
  const [avatarReady, setAvatarReady] = useState(false);
  const [overlayMode, setOverlayMode] = useState(true);
  const hoverAreaRef = useRef(null);
  const [openAccordion, setOpenAccordion] = useState('avatars');
  const [openPanel, setOpenPanel] = useState(null);
  const [commandMenuOpen, setCommandMenuOpen] = useState(false);
  const [scaleMenuOpen, setScaleMenuOpen] = useState(false);
  const [windowScale, setWindowScale] = useState(defaultWindowScale);
  const [selectedAvatarId, setSelectedAvatarId] = useState(defaultAvatarId);
  const [selectedSkinId, setSelectedSkinId] = useState(defaultSkinId);
  const [selectedBg, setSelectedBg] = useState({ type: 'color', value: defaultColor });
  const [audioFile, setAudioFile] = useState(null);
  const [windowSourceId, setWindowSourceId] = useState(null);
  const [audioSourceId, setAudioSourceId] = useState(getDefaultAudioSourceId);
  // A one-shot `audio.play`, never persisted — same relationship to
  // `audioSourceId` that `motionOverlay` has to `animationId`.
  const [voicePlayback, setVoicePlayback] = useState(null);
  const [expressionOverride, setExpressionOverride] = useState(null); // { id, weight } | null
  const [lipSyncSensitivity, setLipSyncSensitivity] = useState(defaultLipSyncSensitivity);
  const [lipSyncMouthStrength, setLipSyncMouthStrength] = useState(defaultLipSyncMouthStrength);
  const [idleBreathingIntensity, setIdleBreathingIntensity] = useState(defaultIdleBreathingIntensity);
  const [poseCycleHoldSeconds, setPoseCycleHoldSeconds] = useState(defaultPoseCycleHoldSeconds);
  const [settingsPath, setSettingsPath] = useState(null);
  const [directories, setDirectories] = useState(createDefaultDirectories);
  const [agentBus, setAgentBus] = useState(createDefaultAgentBus);
  const [voiceHud, setVoiceHud] = useState(createDefaultVoiceHud);
  const [vision, setVision] = useState(createDefaultVision);
  const [brain, setBrain] = useState(createDefaultBrain);
  const [motionDeck, setMotionDeck] = useState(createEmptyDeck);
  const [libraryAvatars, setLibraryAvatars] = useState([]);
  const [libraryAnimations, setLibraryAnimations] = useState([]);
  const [libraryEnvironments, setLibraryEnvironments] = useState([]);
  const [directoriesNotice, setDirectoriesNotice] = useState(null);
  const libraryAvatarsRef = useRef([]);
  const libraryAnimationsRef = useRef([]);
  const libraryEnvironmentsRef = useRef([]);
  /** Id of the environment whose full-size image is currently being read. */
  const environmentSourceLoadRef = useRef(null);
  const panelRef = useRef(null);
  const drawerRef = useRef(null);
  const commandMenuRef = useRef(null);
  const scaleMenuRef = useRef(null);
  const isPanelHovered = useRef(false);
  const skipNextSave = useRef(true);

  const desktopApi = getDesktopApi();

  const { level, levelRef, speaking, status: audioStatus, error: audioError, restart } = useAudioSource(
    audioSourceId,
    audioFile,
    { windowSourceId, sensitivity: lipSyncSensitivity },
  );

  const lipSyncEnabled = audioSourceId !== 'none' && audioStatus === 'active';

  const applySettings = useCallback((settings) => {
    setSelectedAvatarId(settings.avatarId);
    setSelectedSkinId(settings.skinId);
    setAnimationId(settings.animationId);
    setIdlePool(settings.idlePool ?? createDefaultIdlePool());
    setSelectedBg(settings.environment);
    setCamera({
      position: [...settings.camera.position],
      lookAt: [...settings.camera.lookAt],
      fov: settings.camera.fov,
    });
    setLight({
      intensity: settings.light.intensity,
      color: settings.light.color,
      position: [...settings.light.position],
    });
    setAvatar({
      position: [...settings.avatarTransform.position],
      rotation: [...settings.avatarTransform.rotation],
    });
    setAudioSourceId(settings.audioSourceId);
    setLipSyncSensitivity(settings.lipSyncSensitivity);
    setLipSyncMouthStrength(settings.lipSyncMouthStrength);
    setIdleBreathingIntensity(settings.idleBreathingIntensity);
    setPoseCycleHoldSeconds(settings.poseCycleHoldSeconds);
    setWindowSourceId(settings.windowSourceId);
    setOverlayMode(settings.overlayMode);
    document.documentElement.classList.toggle('vox-desktop-windowed', !settings.overlayMode);
    setWindowScale(normalizeWindowScale(settings.windowScale));
    setDirectories(settings.directories ?? createDefaultDirectories());
    setAgentBus(settings.agentBus ?? createDefaultAgentBus());
    setVoiceHud(settings.voice ?? createDefaultVoiceHud());
    setVision(settings.vision ?? createDefaultVision());
    setBrain(settings.brain ?? createDefaultBrain());
    setMotionDeck(settings.motionDeck ?? createEmptyDeck());
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      const settings = await loadUserSettings();
      let hasPersisted = false;

      if (desktopApi?.getSettingsInfo) {
        try {
          const info = await desktopApi.getSettingsInfo();
          if (!cancelled && info?.path) setSettingsPath(info.path);
          hasPersisted = Boolean(info?.exists);
        } catch {
          // ignore
        }
      } else {
        try {
          hasPersisted = Boolean(window.localStorage.getItem('avatar.config.yaml'));
        } catch {
          hasPersisted = false;
        }
      }

      if (!hasPersisted && desktopApi) {
        try {
          if (desktopApi.getOverlayMode) {
            settings.overlayMode = await desktopApi.getOverlayMode();
          }
          if (desktopApi.getWindowScale) {
            settings.windowScale = normalizeWindowScale(await desktopApi.getWindowScale());
          }
        } catch {
          // keep defaults
        }
      }

      if (cancelled) return;
      applySettings(settings);

      if (hasPersisted && desktopApi) {
        if (desktopApi.setOverlayMode) {
          await desktopApi.setOverlayMode(settings.overlayMode);
        }
        if (desktopApi.setWindowScale) {
          await desktopApi.setWindowScale(settings.windowScale);
        }
      }

      skipNextSave.current = true;
      setSettingsReady(true);
    }

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [applySettings, desktopApi]);

  useEffect(() => {
    if (!desktopMode) return undefined;
    let cancelled = false;

    void (async () => {
      try {
        const dir = await getLibraryApi()?.defaultAnimationsDir();
        if (!cancelled) setDefaultAnimationsDir(dir ?? null);
        const avatarsDir = await getLibraryApi()?.defaultAvatarsDir();
        if (!cancelled) setDefaultAvatarsDir(avatarsDir ?? null);
      } catch {
        // No folder beside the app — the bundled pack stands in.
      } finally {
        if (!cancelled) setDefaultAnimationsDirReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!settingsReady) return undefined;

    if (skipNextSave.current) {
      skipNextSave.current = false;
      return undefined;
    }

    const timer = window.setTimeout(() => {
      const snapshot = snapshotUserSettings({
        avatarId: selectedAvatarId,
        skinId: selectedSkinId,
        animationId,
        idlePool,
        environment: selectedBg,
        camera,
        light,
        avatarTransform: avatar,
        audioSourceId,
        lipSyncSensitivity,
        lipSyncMouthStrength,
        idleBreathingIntensity,
        poseCycleHoldSeconds,
        windowSourceId,
        overlayMode,
        windowScale,
        directories,
        motionDeck,
        agentBus,
        voice: voiceHud,
        vision,
        brain,
      });
      void saveUserSettings(snapshot);
    }, SAVE_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [
    settingsReady,
    selectedAvatarId,
    selectedSkinId,
    animationId,
    idlePool,
    selectedBg,
    camera,
    light,
    avatar,
    audioSourceId,
    lipSyncSensitivity,
    lipSyncMouthStrength,
    idleBreathingIntensity,
    poseCycleHoldSeconds,
    windowSourceId,
    overlayMode,
    windowScale,
    directories,
    motionDeck,
    agentBus,
    voiceHud,
    vision,
    brain,
  ]);

  useEffect(() => {
    if (!commandMenuOpen && !openPanel && !scaleMenuOpen) return undefined;

    function handlePointerDown(event) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (commandMenuRef.current?.contains(target)) return;
      if (scaleMenuRef.current?.contains(target)) return;
      if (drawerRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest('.avatar-glass-bar__gear')) return;
      if (target instanceof Element && target.closest('.avatar-glass-bar__scale')) return;
      // Portaled lilac selects render on document.body (outside the drawer).
      if (target instanceof Element && target.closest('.panel-select-menu__list')) return;

      if (commandMenuOpen) setCommandMenuOpen(false);
      if (scaleMenuOpen) setScaleMenuOpen(false);
      if (openPanel) setOpenPanel(null);
    }

    const timer = window.setTimeout(() => {
      window.addEventListener('pointerdown', handlePointerDown);
    }, 120);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [commandMenuOpen, openPanel, scaleMenuOpen]);

  useEffect(() => {
    if (!desktopMode) return undefined;
    function handleBlur() {
      setCommandMenuOpen(false);
      setScaleMenuOpen(false);
    }
    window.addEventListener('blur', handleBlur);
    return () => window.removeEventListener('blur', handleBlur);
  }, []);

  const handleAvatarLoaded = useCallback(() => {
    setAvatarReady(true);
    void getDesktopApi()?.notifyReady?.();
  }, []);

  const customAvatarMode =
    desktopMode && directories.avatars.mode === 'custom' && Boolean(directories.avatars.path);
  // "Default" for avatars is the folder beside the app (`<project>/model`),
  // same as for animations — the bundled samples are gone, so without it
  // there would be nobody on stage. A custom folder replaces it.
  const avatarsPath = customAvatarMode ? directories.avatars.path : defaultAvatarsDir;
  const libraryAvatarMode = desktopMode && Boolean(avatarsPath);
  const avatarCatalog = libraryAvatarMode ? libraryAvatars : bundledAvatars;
  const customAnimationMode =
    desktopMode && directories.animations.mode === 'custom' && Boolean(directories.animations.path);
  // "Default" for animations means the folder that ships beside the app, not
  // the bundled VRMA pack — that folder is where the static poses the Combo
  // entries are built from live. A custom folder still replaces it outright,
  // for previewing a pack before adopting it.
  const animationsPath = customAnimationMode
    ? directories.animations.path
    : defaultAnimationsDir;

  // Pose Cycle and the named Combos are synthetic: appended here, never part
  // of the scanned list itself, so they resolve against whatever the folder
  // actually holds right now rather than a stale snapshot. They are built for
  // either base, so the Combos are in the menu in default mode too.
  //
  // Memoized: VrmAvatar's animation effect depends on this array by
  // reference, and a fresh array every render (even with identical content)
  // would tear that effect down and restart it on every render — which a
  // multi-second pose-sequence hold timer can never survive.
  const animationCatalog = useMemo(() => {
    // Empty whenever the folder is missing, unreadable, or not configured —
    // which is exactly when the bundled pack should stand in.
    const base = libraryAnimations.length > 0 ? libraryAnimations : bundledAnimations;
    const poseCycleEntry = buildPoseCycleEntry(base);
    const poseSequenceEntries = buildPoseSequenceEntries(base);
    return [...base, ...(poseCycleEntry ? [poseCycleEntry] : []), ...poseSequenceEntries];
  }, [libraryAnimations]);
  const appearanceCustomEnvironments =
    desktopMode && directories.environments.mode === 'custom' && Boolean(directories.environments.path)
      ? libraryEnvironments
      : customEnvironments;

  const avatarIds = useMemo(() => avatarCatalog.map((entry) => entry.id), [avatarCatalog]);
  // What the picker can offer is what a command may ask for.
  const environmentIds = useMemo(
    () => [
      ...environments.map((entry) => entry.id),
      ...appearanceCustomEnvironments.map((entry) => entry.id),
    ],
    [appearanceCustomEnvironments],
  );
  // Runtime-dependent, but the runtime cannot change while the app is open.
  const audioSourceIds = useMemo(() => getAudioSourceOptions().map((option) => option.id), []);

  const commandContext = useMemo(
    () => ({ animationCatalog, avatarIds, environmentIds, audioSourceIds }),
    [animationCatalog, avatarIds, environmentIds, audioSourceIds],
  );

  // Single trigger surface: the panels below and, later, hotkeys and the local
  // bus all reach the stage through this (Refs ARPAHLS/avatar#6).
  const { runCommand, applyAction } = useStageCommands({
    context: commandContext,
    current: { selectedAvatarId },
    setters: {
      setAnimationId,
      setAnimationRequest,
      setMotionOverlay,
      setAvatarReady,
      setSelectedAvatarId,
      setSelectedSkinId,
      setSelectedBg,
      setAudioSourceId,
      setVoicePlayback,
      setExpressionOverride,
    },
  });

  const handleVoicePlaybackEnd = useCallback(() => setVoicePlayback(null), []);
  const {
    level: voiceLevel,
    levelRef: voiceLevelRef,
    speaking: voiceSpeaking,
    active: voiceActive,
  } = useVoicePlayback(voicePlayback, handleVoicePlaybackEnd);

  // Her own voice always wins over ambient capture while it is playing —
  // isolated from whatever else the system happens to be making noise with.
  const activeAudioLevel = voiceActive ? voiceLevel : level;
  const activeLevelRef = voiceActive ? voiceLevelRef : levelRef;
  const activeSpeaking = voiceActive ? voiceSpeaking : speaking;
  const activeLipSyncEnabled = voiceActive ? true : lipSyncEnabled;
  const liveDotMode = resolveLiveDotMode({
    audioSourceId,
    audioStatus,
    audioError,
    voiceActive,
  });

  // What `GET /v1/state` answers with. Labels are the point: a custom folder
  // hashes its animation ids from file paths, so nothing here is guessable
  // from outside. Avatars stay id-only, exactly as `avatar.set` accepts them.
  const busSnapshot = useMemo(
    () => ({
      context: commandContext,
      state: {
        animations: animationCatalog.map((entry) => ({
          id: entry.id,
          label: entry.label,
          playableOnce: isPlayableOnce(entry),
        })),
        avatars: avatarIds.map((id) => ({ id })),
        environments: [
          ...environments.map((entry) => ({ id: entry.id, label: entry.label })),
          ...appearanceCustomEnvironments.map((entry) => ({ id: entry.id, label: entry.label })),
        ],
        audioSources: getAudioSourceOptions().map((option) => ({
          id: option.id,
          label: option.label,
        })),
        // So an agent can toggle rather than only set.
        current: {
          animationId,
          overlay: motionOverlay ? { animationId: motionOverlay.animationId } : null,
          avatarId: selectedAvatarId,
          environment: selectedBg,
          audioSourceId,
        },
      },
    }),
    [
      commandContext,
      animationCatalog,
      avatarIds,
      appearanceCustomEnvironments,
      animationId,
      motionOverlay,
      selectedAvatarId,
      selectedBg,
      audioSourceId,
    ],
  );

  const { status: agentBusStatus, rotateToken: rotateAgentBusToken } = useAgentBus({
    settings: agentBus,
    snapshot: busSnapshot,
    applyAction,
    ready: settingsReady,
  });
  const { status: voiceHudStatus, listModels } = useVoiceHud({ settings: voiceHud, vision, brain, ready: settingsReady });

  const handleAnimationChange = useCallback(
    (nextId) => runCommand('animation.play', { id: nextId }),
    [runCommand],
  );

  // Read inside the callbacks below so returning to idle does not have to
  // depend on — and be rebuilt by — every selection change.
  const animationIdRef = useRef(animationId);
  useEffect(() => {
    animationIdRef.current = animationId;
  }, [animationId]);

  /**
   * Where the avatar goes once a one-shot is done. Resolved against the live
   * catalog rather than trusted blindly: a pool saved against a different
   * animations folder holds ids that no longer exist, and asking for one of
   * those would land on the catalog's first clip instead of being ignored.
   */
  const returnToIdle = useCallback(() => {
    // Already resting: an idle that finishes simply holds. Re-picking here
    // would have a one-pose idle restart the moment it settled, every second,
    // for as long as the app stayed open.
    if (idlePool.includes(animationIdRef.current)) return;

    const available = idlePool.filter((id) => findAnimation(animationCatalog, id));
    const nextId = pickIdleAnimation(available, animationIdRef.current);
    if (nextId) runCommand('animation.play', { id: nextId });
  }, [animationCatalog, idlePool, runCommand]);

  const handleMotionOverlayEnd = useCallback(() => {
    setMotionOverlay(null);
    returnToIdle();
  }, [returnToIdle]);

  // A one-shot that was the *selection* rather than a gesture on top of one.
  const handleAnimationSettled = useCallback(() => returnToIdle(), [returnToIdle]);

  const handleToggleIdle = useCallback((id) => {
    setIdlePool((prev) => toggleIdlePool(prev, id));
  }, []);

  // Its panel left Settings; bindings already in config.yaml still play.
  useMotionDeck({
    deck: motionDeck,
    onDeckChange: setMotionDeck,
    animationCatalog,
    runCommand,
  });

  const handleAvatarChange = useCallback(
    (avatarId) => runCommand('avatar.set', { id: avatarId }),
    [runCommand],
  );

  const handleEnvironmentChange = useCallback(
    (selection) => runCommand('environment.set', selection),
    [runCommand],
  );

  const handleAudioSourceChange = useCallback(
    (nextId) => runCommand('audio.source', { id: nextId }),
    [runCommand],
  );

  useEffect(() => {
    libraryAvatarsRef.current = libraryAvatars;
  }, [libraryAvatars]);

  useEffect(() => {
    libraryAnimationsRef.current = libraryAnimations;
  }, [libraryAnimations]);

  useEffect(() => {
    libraryEnvironmentsRef.current = libraryEnvironments;
  }, [libraryEnvironments]);

  useEffect(() => {
    let cancelled = false;

    async function refreshAvatarLibrary() {
      revokeAvatarBlobUrls(libraryAvatarsRef.current);
      // Thumbnails are keyed by path, so a rescan has to drop them too or a
      // replaced .vrm keeps showing its old portrait.
      revokeThumbnailUrls();
      if (!libraryAvatarMode) {
        if (!cancelled) {
          setLibraryAvatars([]);
        }
        return;
      }

      const { avatars: next, error } = await loadLibraryAvatars(avatarsPath);
      if (cancelled) {
        revokeAvatarBlobUrls(next);
        return;
      }
      setLibraryAvatars(next);
      if (error) {
        setDirectoriesNotice(error);
        setDirectories((prev) => ({
          ...prev,
          avatars: createDefaultDirectorySource(),
        }));
        setSelectedAvatarId(defaultAvatarId);
        setSelectedSkinId(defaultSkinId);
        // Same bundled path may not re-fire onLoaded — force the stage visible again.
        setAvatarReady(true);
        return;
      }
      setDirectoriesNotice((prev) =>
        prev && prev.toLowerCase().includes('avatar') ? null : prev,
      );
      if (next.length === 0) {
        setDirectoriesNotice(
          'No .vrm files in that folder. Keeping the default avatar list.',
        );
        setDirectories((prev) => ({
          ...prev,
          avatars: createDefaultDirectorySource(),
        }));
        setLibraryAvatars([]);
        setSelectedAvatarId(defaultAvatarId);
        setSelectedSkinId(defaultSkinId);
        setAvatarReady(true);
        return;
      }
      setSelectedAvatarId((current) =>
        next.some((entry) => entry.id === current) ? current : next[0].id,
      );
      setSelectedSkinId(defaultSkinId);
      setAvatarReady(false);
    }

    void refreshAvatarLibrary();
    return () => {
      cancelled = true;
    };
  }, [libraryAvatarMode, avatarsPath]);

  useEffect(() => {
    let cancelled = false;

    async function refreshAnimationLibrary() {
      // Retire the old urls only once their replacements are in state, so a load
      // still in flight resolves — same hazard the environments list hit (ARPAHLS/avatar#39).
      const previous = libraryAnimationsRef.current;

      // Wait for the default folder to resolve before deciding there is none,
      // or the first pass would fall back to the bundled pack and reset the
      // persisted selection out from under the folder that is about to load.
      if (!defaultAnimationsDirReady) return;

      if (!animationsPath) {
        if (!cancelled) {
          setLibraryAnimations([]);
          revokeAnimationBlobUrls(previous);
        }
        return;
      }

      const { animations: next, error, notice } = await loadLibraryAnimations(animationsPath);
      if (cancelled) {
        // A newer run captured the same `previous` and owns retiring it.
        revokeAnimationBlobUrls(next);
        return;
      }
      setLibraryAnimations(next);
      revokeAnimationBlobUrls(previous);

      if (error || next.length === 0) {
        setLibraryAnimations([]);
        revokeAnimationBlobUrls(next);
        // Only a folder the *user* chose is worth complaining about and
        // clearing. The default folder failing just means this install has
        // none, and the bundled pack quietly stands in.
        if (customAnimationMode) {
          setDirectoriesNotice(
            error ?? 'No .vrma files in that folder. Keeping the default animation list.',
          );
          setDirectories((prev) => ({
            ...prev,
            animations: createDefaultDirectorySource(),
          }));
          setAnimationId(defaultAnimationId);
        }
        return;
      }

      setDirectoriesNotice((prev) =>
        notice ?? (prev && prev.toLowerCase().includes('animation') ? null : prev),
      );
      // Ids hash the file path, so the same clip keeps its selection across a
      // rescan; only a folder swap or a file gone since last launch retires
      // one. Synthetic entries (Pose Cycle, the Combos) are not in `next` and
      // would look retired to a plain lookup, so they are checked separately —
      // they exist for any folder that still has the poses behind them.
      setAnimationId((current) => {
        if (current === buildPoseCycleEntry(next)?.id) return current;
        if (buildPoseSequenceEntries(next).some((entry) => entry.id === current)) return current;
        return resolveAnimationId(next, current);
      });
    }

    void refreshAnimationLibrary();
    return () => {
      cancelled = true;
    };
  }, [animationsPath, customAnimationMode, defaultAnimationsDirReady]);

  useEffect(() => {
    let cancelled = false;

    async function refreshEnvLibrary() {
      // Revoking before the await left the stage and the picker pointing at
      // urls that no longer resolve for as long as the replacement took to
      // load. Already-decoded images survive revocation, so nothing changed on
      // screen — but a remount in that window loaded nothing. Hold the old list
      // and drop it only once its replacement is in state (ARPAHLS/avatar#39).
      const previous = libraryEnvironmentsRef.current;
      // Posters are keyed by path, so a rescan has to drop them or an image
      // replaced in place keeps serving its old one: the disk cache would catch
      // the new mtime, but this session's url cache answers first.
      revokeEnvironmentThumbnailUrls();
      const useLibrary =
        desktopMode &&
        directories.environments.mode === 'custom' &&
        Boolean(directories.environments.path);

      if (!useLibrary) {
        setLibraryCustomEnvironments([]);
        if (!cancelled) {
          setLibraryEnvironments([]);
          revokeEnvironmentBlobUrls(previous);
        }
        return;
      }

      const { environments: next, error } = await loadLibraryEnvironments(
        directories.environments.path,
      );
      if (cancelled) {
        // A newer run captured the same `previous` and owns retiring it.
        revokeEnvironmentBlobUrls(next);
        return;
      }
      setLibraryEnvironments(next);
      setLibraryCustomEnvironments(next);
      revokeEnvironmentBlobUrls(previous);
      if (error) {
        setDirectoriesNotice(error);
        setDirectories((prev) => ({
          ...prev,
          environments: createDefaultDirectorySource(),
        }));
        setLibraryEnvironments([]);
        setLibraryCustomEnvironments([]);
        revokeEnvironmentBlobUrls(next);
        setSelectedBg((prev) =>
          prev.type === 'env' && String(prev.id).startsWith('lib-env-')
            ? { type: 'color', value: defaultColor }
            : prev,
        );
        return;
      }
      if (next.length === 0) {
        setDirectoriesNotice(
          'No .gif / .png / .jpg / .jpeg files in that folder. Keeping the default environment source.',
        );
        setDirectories((prev) => ({
          ...prev,
          environments: createDefaultDirectorySource(),
        }));
        setLibraryEnvironments([]);
        setLibraryCustomEnvironments([]);
        revokeEnvironmentBlobUrls(next);
        setSelectedBg((prev) =>
          prev.type === 'env' && String(prev.id).startsWith('lib-env-')
            ? { type: 'color', value: defaultColor }
            : prev,
        );
        return;
      }
      setDirectoriesNotice((prev) =>
        prev && prev.toLowerCase().includes('environment') ? null : prev,
      );
    }

    void refreshEnvLibrary();
    return () => {
      cancelled = true;
    };
  }, [directories.environments.mode, directories.environments.path]);

  useEffect(() => {
    // Bytes are held for the environment on stage and, while one is being read,
    // for the outgoing one the stage is still showing — never for the whole
    // folder, which is what loadLibraryEnvironments used to do the moment the
    // folder was configured. The picker draws posters instead.
    const selectedId = selectedBg.type === 'env' ? selectedBg.id : null;

    // The registry backs getEnvironmentById, which the holo field and the
    // chrome tone both read during render, so it has to move with the state
    // rather than trail it by an effect.
    const publish = (next) => {
      setLibraryCustomEnvironments(next);
      setLibraryEnvironments(next);
    };

    const target = selectedId
      ? libraryEnvironments.find((entry) => entry.id === selectedId)
      : null;

    // The stage holds the previous background until the incoming one is ready,
    // so its url is still on screen and cannot be released yet.
    if (!target || target.src) {
      const stale = libraryEnvironments.filter((entry) => entry.src && entry.id !== selectedId);
      if (stale.length > 0) {
        revokeEnvironmentBlobUrls(stale);
        publish(
          libraryEnvironments.map((entry) =>
            entry.src && entry.id !== selectedId ? { ...entry, src: null } : entry,
          ),
        );
      }
      return undefined;
    }

    // Publishing below re-runs this effect, and rapid switching can re-enter it
    // for an id already being read. One marker cannot cover every interleaving,
    // so the read itself checks again before it publishes.
    if (environmentSourceLoadRef.current === target.id) return undefined;
    environmentSourceLoadRef.current = target.id;

    void (async () => {
      try {
        const url = await loadEnvironmentSource(target);
        if (!url) return;
        const current = libraryEnvironmentsRef.current;
        const entry = current.find((candidate) => candidate.id === target.id);
        // Gone in a rescan, or another read of the same file got there first.
        if (!entry || entry.src) {
          URL.revokeObjectURL(url);
          return;
        }
        // Published even if the selection has moved on: the pass above releases
        // it on the next run, which is cheaper than losing the read and having
        // to redo it if the user comes back.
        publish(current.map((item) => (item.id === target.id ? { ...item, src: url } : item)));
      } finally {
        if (environmentSourceLoadRef.current === target.id) {
          environmentSourceLoadRef.current = null;
        }
      }
    })();

    return undefined;
  }, [selectedBg, libraryEnvironments]);

  useEffect(() => {
    return () => {
      revokeAvatarBlobUrls(libraryAvatarsRef.current);
      revokeThumbnailUrls();
      revokeAnimationBlobUrls(libraryAnimationsRef.current);
      revokeEnvironmentBlobUrls(libraryEnvironmentsRef.current);
      revokeEnvironmentThumbnailUrls();
      setLibraryCustomEnvironments([]);
    };
  }, []);

  const handleBrowseDirectory = useCallback(async (kind) => {
    const api = getLibraryApi();
    if (!api) return;
    const picked = await api.pickFolder();
    if (!picked) return;

    try {
      if (kind === 'avatars') {
        const scanned = await api.scanAvatars(picked);
        if (!scanned.length) {
          setDirectoriesNotice(
            'No .vrm files in that folder. Keeping the current avatar source.',
          );
          return;
        }
      } else if (kind === 'animations') {
        const scanned = await api.scanAnimations(picked);
        if (!scanned.length) {
          setDirectoriesNotice(
            'No .vrma files in that folder. Keeping the current animation source.',
          );
          return;
        }
      } else if (kind === 'environments') {
        const scanned = await api.scanEnvironments(picked);
        if (!scanned.length) {
          setDirectoriesNotice(
            'No .gif / .png / .jpg / .jpeg files in that folder. Keeping the current environment source.',
          );
          return;
        }
      }
    } catch (error) {
      setDirectoriesNotice(
        error instanceof Error ? error.message : 'Could not read that folder.',
      );
      return;
    }

    setDirectoriesNotice(null);
    setDirectories((prev) => ({
      ...prev,
      [kind]: { mode: 'custom', path: picked },
    }));
    if (kind === 'avatars') {
      setAvatarReady(false);
    }
  }, []);

  const handleOpenDirectory = useCallback(
    async (kind) => {
      const api = getLibraryApi();
      const pathValue = directories[kind]?.path;
      if (!api || !pathValue) return;
      try {
        await api.openFolder(pathValue);
      } catch (error) {
        setDirectoriesNotice(error instanceof Error ? error.message : 'Could not open folder.');
      }
    },
    [directories],
  );

  const handleClearDirectory = useCallback((kind) => {
    setDirectoriesNotice(null);
    setDirectories((prev) => ({
      ...prev,
      [kind]: createDefaultDirectorySource(),
    }));
    if (kind === 'avatars') {
      setSelectedAvatarId(defaultAvatarId);
      setSelectedSkinId(defaultSkinId);
      setAvatarReady(false);
    }
    if (kind === 'animations') {
      setAnimationId(defaultAnimationId);
    }
    if (kind === 'environments') {
      setSelectedBg((prev) =>
        prev.type === 'env' && String(prev.id).startsWith('lib-env-')
          ? { type: 'color', value: defaultColor }
          : prev,
      );
    }
  }, []);

  const modelPath = libraryAvatarMode
    ? libraryAvatars.find((entry) => entry.id === selectedAvatarId)?.skins?.[0]?.path ??
      libraryAvatars[0]?.skins?.[0]?.path ??
      null
    : resolveAvatarPath(selectedAvatarId, selectedSkinId);

  // Avoid a blank companion shell when there is no model to load (e.g. mid-reject).
  useEffect(() => {
    if (!modelPath) {
      setAvatarReady(true);
    }
  }, [modelPath]);

  // The mixer belongs to the VRM, so a gesture cannot outlive the model it was
  // playing on — nor the catalog holding the url it was loaded from.
  useEffect(() => {
    setMotionOverlay(null);
  }, [modelPath, animationCatalog]);

  async function handleOverlayModeToggle() {
    const next = !overlayMode;
    setOverlayMode(next);
    document.documentElement.classList.toggle('vox-desktop-windowed', !next);
    await desktopApi?.setOverlayMode?.(next);
  }

  function handleCloseWindow() {
    void desktopApi?.closeWindow?.();
  }

  function handleCommandMenuChange(open) {
    setCommandMenuOpen(open);
    if (open) setScaleMenuOpen(false);
  }

  function handleScaleMenuChange(open) {
    setScaleMenuOpen(open);
    if (open) setCommandMenuOpen(false);
  }

  async function handleWindowScaleChange(factor) {
    const nextScale = normalizeWindowScale(factor);
    if (desktopApi?.setWindowScale) {
      const applied = await desktopApi.setWindowScale(nextScale);
      setWindowScale(normalizeWindowScale(typeof applied === 'number' ? applied : nextScale));
      return;
    }
    setWindowScale(nextScale);
  }

  async function handleResetAllSettings() {
    const defaults = await resetUserSettings();
    skipNextSave.current = true;

    // Only hide the stage when the VRM actually reloads — same path never
    // re-fires onLoaded, which left the whole UI at opacity 0 (looked like a crash).
    const nextPath = resolveAvatarPath(defaults.avatarId, defaults.skinId);
    if (nextPath !== modelPath) {
      setAvatarReady(false);
    }

    applySettings(defaults);
    setDirectories(createDefaultDirectories());
    setDirectoriesNotice(null);
    setLibraryCustomEnvironments([]);
    revokeAvatarBlobUrls(libraryAvatarsRef.current);
    revokeThumbnailUrls();
    revokeAnimationBlobUrls(libraryAnimationsRef.current);
    revokeEnvironmentBlobUrls(libraryEnvironmentsRef.current);
    setLibraryAvatars([]);
    setLibraryAnimations([]);
    setLibraryEnvironments([]);
    setAudioFile(null);
    setAnimationRequest((count) => count + 1);

    try {
      if (desktopApi?.setOverlayMode) {
        await desktopApi.setOverlayMode(defaults.overlayMode);
      }
      if (desktopApi?.setWindowScale) {
        await desktopApi.setWindowScale(defaults.windowScale);
      }
    } catch {
      // Keep in-app defaults even if native window APIs fail.
    }

    skipNextSave.current = true;
    void saveUserSettings(createDefaultUserSettings());
  }

  return (
    <div className="avatar-stage">
      <div
        className={`avatar-hover-area ${avatarReady ? 'avatar-hover-area--ready' : ''}`}
        ref={hoverAreaRef}
        style={{ width: STAGE.width, height: STAGE.height, '--stage-bar-height': `${STAGE.barHeight}px` }}
      >
        <AvatarStageShell
          environmentSelection={selectedBg}
          commandMenuOpen={commandMenuOpen}
          onCommandMenuChange={handleCommandMenuChange}
          commandMenuRef={commandMenuRef}
          scaleMenuOpen={scaleMenuOpen}
          onScaleMenuChange={handleScaleMenuChange}
          scaleMenuRef={scaleMenuRef}
          windowScale={windowScale}
          onWindowScaleChange={handleWindowScaleChange}
          onOpenPanel={setOpenPanel}
          openPanel={openPanel}
          animationId={animationId}
          animationCatalog={animationCatalog}
          onAnimationChange={handleAnimationChange}
          idlePool={idlePool}
          onToggleIdle={handleToggleIdle}
          overlayMode={overlayMode}
          onOverlayModeToggle={handleOverlayModeToggle}
          onCloseWindow={handleCloseWindow}
          liveDotMode={liveDotMode}
          liveDotLevelRef={activeLevelRef}
        >
          <Canvas
            camera={{ position: camera.position, fov: camera.fov }}
            className="avatar-canvas"
            gl={{ alpha: true, antialias: true }}
            style={{ visibility: avatarReady ? 'visible' : 'hidden' }}
          >
            <CameraController cameraState={camera} />
            <ambientLight intensity={light.intensity} />
            <directionalLight position={light.position} intensity={light.intensity} color={light.color} />
            <VrmAvatar
              modelPath={modelPath}
              animationId={animationId}
              animationCatalog={animationCatalog}
              animationRequest={animationRequest}
              motionOverlay={motionOverlay}
              onMotionOverlayEnd={handleMotionOverlayEnd}
              onAnimationSettled={handleAnimationSettled}
              avatarPosition={avatar.position}
              avatarRotation={avatar.rotation}
              audioLevel={activeAudioLevel}
              lipSyncEnabled={activeLipSyncEnabled}
              lipSyncMouthStrength={lipSyncMouthStrength}
              idleBreathingIntensity={idleBreathingIntensity}
              poseCycleHoldSeconds={poseCycleHoldSeconds}
              speaking={activeSpeaking}
              expressionOverride={expressionOverride}
              onLoaded={handleAvatarLoaded}
            />
          </Canvas>
        </AvatarStageShell>

        <GlassDrawer
          open={Boolean(openPanel)}
          panelId={openPanel}
          onClose={() => setOpenPanel(null)}
          drawerRef={drawerRef}
        >
          {openPanel === 'palette' && (
            <PalettePanel
              openAccordion={openAccordion}
              setOpenAccordion={setOpenAccordion}
              avatarCatalog={avatarCatalog}
              customAvatarMode={customAvatarMode}
              selectedAvatarId={selectedAvatarId}
              onAvatarChange={handleAvatarChange}
              selectedBg={selectedBg}
              onEnvironmentChange={handleEnvironmentChange}
              customEnvironmentList={appearanceCustomEnvironments}
              directories={desktopMode ? directories : null}
              onBrowseDirectory={handleBrowseDirectory}
              onOpenDirectory={handleOpenDirectory}
              onClearDirectory={handleClearDirectory}
              directoriesNotice={directoriesNotice}
            />
          )}

          {openPanel === 'voice' && (
            <VoicePanel
              audioSourceId={audioSourceId}
              onAudioSourceChange={handleAudioSourceChange}
              setAudioFile={setAudioFile}
              windowSourceId={windowSourceId}
              setWindowSourceId={setWindowSourceId}
              audioStatus={audioStatus}
              audioError={audioError}
              onRestartAudio={() => void restart()}
              lipSyncSensitivity={lipSyncSensitivity}
              onLipSyncSensitivityChange={setLipSyncSensitivity}
              lipSyncMouthStrength={lipSyncMouthStrength}
              onLipSyncMouthStrengthChange={setLipSyncMouthStrength}
              idleBreathingIntensity={idleBreathingIntensity}
              onIdleBreathingIntensityChange={setIdleBreathingIntensity}
              poseCycleHoldSeconds={poseCycleHoldSeconds}
              onPoseCycleHoldSecondsChange={setPoseCycleHoldSeconds}
            />
          )}

          {openPanel === 'camera' && (
            <div
              ref={panelRef}
              onMouseEnter={() => {
                isPanelHovered.current = true;
              }}
              onMouseLeave={() => {
                isPanelHovered.current = false;
              }}
            >
              <CameraPanel
                openAccordion={openAccordion}
                setOpenAccordion={setOpenAccordion}
                camera={camera}
                setCamera={setCamera}
                light={light}
                setLight={setLight}
                avatar={avatar}
                setAvatar={setAvatar}
              />
            </div>
          )}

          {openPanel === 'settings' && (
            <div ref={panelRef}>
              {desktopMode && (
                <DesktopPanel overlayMode={overlayMode} onOverlayModeToggle={handleOverlayModeToggle} />
              )}
              {desktopMode && (
                <>
                  <Divider />
                  <p className="settings-section-title">Agents</p>
                  <AgentBusPanel
                    settings={agentBus}
                    status={agentBusStatus}
                    onChange={setAgentBus}
                    onRotateToken={rotateAgentBusToken}
                  />
                </>
              )}
              {desktopMode && (
                <>
                  <Divider />
                  <p className="settings-section-title">Voice input</p>
                  <VoiceHudPanel settings={voiceHud} status={voiceHudStatus} onChange={setVoiceHud} />
                </>
              )}
              {desktopMode && (
                <>
                  <Divider />
                  <p className="settings-section-title">Brain</p>
                  <BrainPanel settings={brain} onChange={setBrain} listModels={listModels} />
                </>
              )}
              {desktopMode && (
                <>
                  <Divider />
                  <p className="settings-section-title">Vision</p>
                  <VisionPanel settings={vision} onChange={setVision} />
                </>
              )}
              <Divider />
              <p className="settings-section-title">System</p>
              <button
                type="button"
                className="panel-button panel-button--danger"
                onClick={() => void handleResetAllSettings()}
              >
                Reset all settings
              </button>
              <p className="panel-note panel-note--compact">
                Preferences are saved to {settingsPath ? 'config.yaml' : 'local storage'} and restored on
                launch.
              </p>
              {settingsPath && (
                <p className="panel-note panel-note--compact panel-note--mono">{settingsPath}</p>
              )}
            </div>
          )}
        </GlassDrawer>
      </div>
    </div>
  );
}
