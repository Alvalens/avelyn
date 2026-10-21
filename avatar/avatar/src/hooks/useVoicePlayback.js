import { useEffect, useRef } from 'react';
import { useAudioAnalyser } from './useAudioAnalyser';

/**
 * One-shot playback of audio bytes delivered over the agent bus (`audio.play`,
 * Refs ARPAHLS/avatar#6), with its own amplitude analyser — independent of whatever ambient
 * `audioSourceId` is selected, so Avelyn's own voice always drives the mouth
 * and nothing else the system happens to be playing does.
 *
 * Same Blob-from-bytes approach `userLibrary.js` uses for library files, not a
 * `file://` URL: the main process already read the bytes (see `main.cjs`'s
 * `applyAction`), so the renderer never touches a path.
 *
 * @param {{ buffer: Uint8Array } | null} playback
 * @param {() => void} onEnded
 */
export function useVoicePlayback(playback, onEnded) {
  const { attach, detach, level, levelRef, speaking } = useAudioAnalyser(Boolean(playback), 1);
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;

  useEffect(() => {
    if (!playback) return undefined;

    let cancelled = false;
    const audioContext = new AudioContext();
    const blobUrl = URL.createObjectURL(new Blob([playback.buffer], { type: 'audio/wav' }));
    const audio = new Audio(blobUrl);

    const finish = () => {
      if (cancelled) return;
      cancelled = true;
      detach();
      onEndedRef.current?.();
    };

    audio.addEventListener('ended', finish);
    audio.addEventListener('error', finish);

    audio
      .play()
      .then(() => {
        if (cancelled) return;
        const source = audioContext.createMediaElementSource(audio);
        attach(source, audioContext, { monitor: true });
      })
      .catch(finish);

    return () => {
      cancelled = true;
      audio.removeEventListener('ended', finish);
      audio.removeEventListener('error', finish);
      audio.pause();
      audio.src = '';
      URL.revokeObjectURL(blobUrl);
      void audioContext.close().catch(() => {});
    };
  }, [playback, attach, detach]);

  return { level, levelRef, speaking, active: Boolean(playback) };
}
