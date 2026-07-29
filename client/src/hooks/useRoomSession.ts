/**
 * React-обёртка над оркестратором (задача IP 9, TDD §4.6).
 *
 * Здесь только жизненный цикл и привязка `<video>`-элементов к потокам. Сама
 * оркестрация — в `services/roomSession.ts`, поэтому она проверяется сквозным
 * тестом на реальном сокете без рендера компонентов.
 *
 * ★ Потоки и элементы держатся в `useRef`, а не в состоянии (9.2): появление
 * ICE-кандидата или новой дорожки не должно перерисовывать видеосетку. В
 * состояние React уходит только presence — через reducer.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MediaState } from '@video-chat/shared';
import { startRoomSession, type RoomSession } from '../services/roomSession';
import type { MediaErrorKind, RoomAction } from '../state/roomReducer';
import type { ClientSocket } from '../services/socket';

export interface UseRoomSessionOptions {
  /** Сессия работает, пока экран этого требует (`acquiringMedia`…`inRoom`). */
  enabled: boolean;
  roomId: string;
  name: string;
  dispatch: (action: RoomAction) => void;
  onInvalidRoomId: () => void;

  // Фабрики для тестов.
  mediaDevices?: MediaDevices;
  createSocketFn?: () => ClientSocket;
  createPeerConnection?: (configuration: RTCConfiguration) => RTCPeerConnection;
  createMediaStream?: () => MediaStream;
}

export interface UseRoomSessionResult {
  media: MediaState;
  mediaError: MediaErrorKind | null;
  toggleMic: () => void;
  toggleCamera: () => void;
  leave: () => void;
  /** `ref`-колбэк для self-view. */
  attachSelfVideo: (element: HTMLVideoElement | null) => void;
  /** `ref`-колбэк для плитки участника: `attachPeerVideo(peerId)`. */
  attachPeerVideo: (peerId: string) => (element: HTMLVideoElement | null) => void;
}

export function useRoomSession(options: UseRoomSessionOptions): UseRoomSessionResult {
  const [media, setMedia] = useState<MediaState>({ audio: false, video: false });
  const [mediaError, setMediaError] = useState<MediaErrorKind | null>(null);

  const sessionRef = useRef<RoomSession | null>(null);
  const selfVideoRef = useRef<HTMLVideoElement | null>(null);
  const selfTrackRef = useRef<MediaStreamTrack | null>(null);
  /** Элементы плиток: нужны, чтобы присвоить `srcObject` при монтировании. */
  const peerElements = useRef(new Map<string, HTMLVideoElement>());
  const peerStreams = useRef(new Map<string, MediaStream>());
  const latest = useRef(options);
  latest.current = options;

  /**
   * ★ Присвоение `srcObject` происходит и при появлении потока, и при
   * монтировании элемента. Одного колбэка недостаточно: поток может прийти
   * раньше, чем React отрендерит плитку (этот дефект был найден на ручной
   * приёмке группы 7 для self-view).
   */
  const applySelfTrack = (element: HTMLVideoElement | null): void => {
    if (!element) return;
    const track = selfTrackRef.current;
    element.srcObject = track ? new MediaStream([track]) : null;
  };

  const attachSelfVideo = useCallback((element: HTMLVideoElement | null) => {
    selfVideoRef.current = element;
    applySelfTrack(element);
  }, []);

  const attachPeerVideo = useCallback(
    (peerId: string) => (element: HTMLVideoElement | null) => {
      if (element === null) {
        peerElements.current.delete(peerId);
        return;
      }
      peerElements.current.set(peerId, element);
      const stream = peerStreams.current.get(peerId);
      // ★ Поток пира один на всё время жизни соединения, поэтому присваиваем
      // ровно один раз — пересоздание `srcObject` даёт мигание (TDD §4.5).
      if (stream && element.srcObject !== stream) element.srcObject = stream;
    },
    [],
  );

  useEffect(() => {
    if (!options.enabled) return;

    const session = startRoomSession({
      roomId: latest.current.roomId,
      name: latest.current.name,
      dispatch: (action) => latest.current.dispatch(action),
      onInvalidRoomId: () => latest.current.onInvalidRoomId(),
      onMediaState: setMedia,
      onMediaError: setMediaError,
      onSelfVideoTrack: (track) => {
        selfTrackRef.current = track;
        applySelfTrack(selfVideoRef.current);
      },
      onRemoteStream: (peerId, stream) => {
        peerStreams.current.set(peerId, stream);
        const element = peerElements.current.get(peerId);
        if (element && element.srcObject !== stream) element.srcObject = stream;
      },
      onRemoteStreamGone: (peerId) => {
        peerStreams.current.delete(peerId);
        const element = peerElements.current.get(peerId);
        if (element) element.srcObject = null;
        peerElements.current.delete(peerId);
      },
      ...(latest.current.mediaDevices ? { mediaDevices: latest.current.mediaDevices } : {}),
      ...(latest.current.createSocketFn ? { createSocketFn: latest.current.createSocketFn } : {}),
      ...(latest.current.createPeerConnection
        ? { createPeerConnection: latest.current.createPeerConnection }
        : {}),
      ...(latest.current.createMediaStream
        ? { createMediaStream: latest.current.createMediaStream }
        : {}),
    });
    sessionRef.current = session;

    // Ссылки на Map'ы копируются в замыкание эффекта: к моменту очистки
    // `ref.current` мог бы указывать уже на другой объект.
    const streams = peerStreams.current;
    const elements = peerElements.current;

    return () => {
      // ★ 9.3: размонтирование = выход. Без этого камера продолжает работать
      // после ухода со страницы (риск R7).
      session.teardown();
      sessionRef.current = null;
      streams.clear();
      elements.clear();
      selfTrackRef.current = null;
    };
    // Сессия создаётся ровно один раз на «включение»: пересоздание разорвало бы
    // живой звонок. Остальные поля читаются через ref.
  }, [options.enabled, options.roomId]);

  return {
    media,
    mediaError,
    toggleMic: () => sessionRef.current?.toggleMic(),
    toggleCamera: () => sessionRef.current?.toggleCamera(),
    leave: () => sessionRef.current?.leave(),
    attachSelfVideo,
    attachPeerVideo,
  };
}
