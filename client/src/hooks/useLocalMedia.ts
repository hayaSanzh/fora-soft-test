/**
 * React-обёртка над локальными дорожками (задача IP 7).
 *
 * Логика целиком в `services/localMedia.ts`; здесь только жизненный цикл и
 * состояние для рендера. Сами дорожки **не хранятся в состоянии React**: их
 * изменение не должно вызывать ре-рендер видеосетки (TDD §4.6, §9.3), поэтому
 * они живут в `useRef` и отдаются наружу через `getVideoTrack()`.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MediaState } from '@video-chat/shared';
import { LocalMedia } from '../services/localMedia';
import type { MediaErrorKind } from '../state/roomReducer';

export interface UseLocalMediaOptions {
  /** Запрашивать устройства (экран `acquiringMedia`). */
  enabled: boolean;
  /** Вызывается один раз по завершении первичного запроса — успешного или нет. */
  onAcquired?: (state: MediaState, error: MediaErrorKind | null) => void;
  /** Состояние изменилось: разослать `media:state` остальным (ФТ-15…18). */
  onStateChange?: (state: MediaState) => void;
  onAudioTrack?: (track: MediaStreamTrack | null) => void;
  onVideoTrack?: (track: MediaStreamTrack | null) => void;
  /** Подменяется в тестах. */
  mediaDevices?: MediaDevices;
}

export interface UseLocalMediaResult {
  media: MediaState;
  error: MediaErrorKind | null;
  toggleMic: () => void;
  toggleCamera: () => void;
  getAudioTrack: () => MediaStreamTrack | null;
  getVideoTrack: () => MediaStreamTrack | null;
  /** Остановить всё: вызывается при выходе и размонтировании (ФТ-27, R7). */
  teardown: () => void;
}

export function useLocalMedia(options: UseLocalMediaOptions): UseLocalMediaResult {
  const [media, setMedia] = useState<MediaState>({ audio: false, video: false });
  const [error, setError] = useState<MediaErrorKind | null>(null);
  const mediaRef = useRef<LocalMedia | null>(null);
  const latest = useRef(options);
  latest.current = options;

  useEffect(() => {
    if (!options.enabled) return;

    const local = new LocalMedia({
      ...(latest.current.mediaDevices ? { mediaDevices: latest.current.mediaDevices } : {}),
      onStateChange: (state) => {
        setMedia(state);
        latest.current.onStateChange?.(state);
      },
      onError: setError,
      onAudioTrack: (track) => latest.current.onAudioTrack?.(track),
      onVideoTrack: (track) => latest.current.onVideoTrack?.(track),
    });
    mediaRef.current = local;

    let acquireError: MediaErrorKind | null = null;
    void local
      .acquire()
      .then((state) => {
        // Колбэк вызывается всегда: и при успехе, и при отказе — вход в комнату
        // продолжается в любом случае (ФТ-14, ФТ-33).
        latest.current.onAcquired?.(state, acquireError);
      })
      .catch(() => {
        acquireError = 'Unknown';
        latest.current.onAcquired?.({ audio: false, video: false }, 'Unknown');
      });

    return () => {
      local.teardown();
      mediaRef.current = null;
    };
    // Запрос устройств выполняется ровно один раз на «включение».
  }, [options.enabled]);

  const toggleMic = useCallback(() => {
    const local = mediaRef.current;
    if (!local) return;
    void local.setMicEnabled(!local.state.audio);
  }, []);

  const toggleCamera = useCallback(() => {
    const local = mediaRef.current;
    if (!local) return;
    void local.setCameraEnabled(!local.state.video);
  }, []);

  return {
    media,
    error,
    toggleMic,
    toggleCamera,
    getAudioTrack: () => mediaRef.current?.getAudioTrack() ?? null,
    getVideoTrack: () => mediaRef.current?.getVideoTrack() ?? null,
    teardown: () => mediaRef.current?.teardown(),
  };
}
