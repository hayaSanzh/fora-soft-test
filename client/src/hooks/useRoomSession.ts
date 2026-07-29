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
import { VideoAttachments } from '../services/videoAttachments';
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
  sendChatMessage: (text: string) => void;
  /** Браузер отклонил воспроизведение по политике автозапуска (ФТ-37). */
  audioBlocked: boolean;
  /** Повторить `play()` для всех плиток — вызывать **из обработчика клика**. */
  enableAudio: () => void;
  /**
   * `ref`-колбэк для плитки участника.
   *
   * ★ Колбэк **кеширован по участнику**: `React.memo` на плитке (задача 10.9)
   * сравнивает пропсы по ссылке, и новая функция на каждый рендер сводила бы
   * мемоизацию к нулю — сетка перерисовывалась бы на каждое сообщение в чате.
   */
  attachVideo: (
    participantId: string,
    isSelf: boolean,
  ) => (element: HTMLVideoElement | null) => void;
}

export function useRoomSession(options: UseRoomSessionOptions): UseRoomSessionResult {
  const [media, setMedia] = useState<MediaState>({ audio: false, video: false });
  const [mediaError, setMediaError] = useState<MediaErrorKind | null>(null);
  /** Политика автозапуска отклонила `play()` — нужен жест пользователя (11.5). */
  const [audioBlocked, setAudioBlocked] = useState(false);

  const sessionRef = useRef<RoomSession | null>(null);
  const selfVideoRef = useRef<HTMLVideoElement | null>(null);
  const selfTrackRef = useRef<MediaStreamTrack | null>(null);
  const latest = useRef(options);
  latest.current = options;

  /**
   * Привязка потоков пиров к элементам вынесена в `VideoAttachments`: там
   * собраны все её нюансы (поток раньше элемента, запрет повторного присвоения,
   * политика автозапуска), и там они проверяются тестами без jsdom.
   */
  const attachments = useRef<VideoAttachments | null>(null);
  attachments.current ??= new VideoAttachments(() => setAudioBlocked(true));

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
      attachments.current?.setElement(peerId, element);
    },
    [],
  );

  /**
   * Повтор воспроизведения по жесту пользователя (задача 11.5).
   *
   * ★ Вызывать только из обработчика клика: `play()` запрашивается для всех
   * элементов синхронно, потому что разрешение действует ровно на время
   * обработки жеста.
   */
  const enableAudio = useCallback(() => {
    void attachments.current?.resumeAll().then((allPlaying) => {
      if (allPlaying) setAudioBlocked(false);
    });
  }, []);

  /** Кеш `ref`-колбэков: идентичность обязана быть стабильной (задача 10.9). */
  const attachCache = useRef(new Map<string, (element: HTMLVideoElement | null) => void>());
  const attachVideo = useCallback(
    (participantId: string, isSelf: boolean) => {
      const key = isSelf ? 'self' : participantId;
      const cached = attachCache.current.get(key);
      if (cached) return cached;
      const callback = isSelf ? attachSelfVideo : attachPeerVideo(participantId);
      attachCache.current.set(key, callback);
      return callback;
    },
    [attachSelfVideo, attachPeerVideo],
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
        attachments.current?.setStream(peerId, stream);
      },
      onRemoteStreamGone: (peerId) => {
        attachments.current?.removeStream(peerId);
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

    // Ссылки копируются в замыкание эффекта: к моменту очистки `ref.current`
    // мог бы указывать уже на другой объект.
    const bound = attachments.current;
    const cache = attachCache.current;

    return () => {
      // ★ 9.3: размонтирование = выход. Без этого камера продолжает работать
      // после ухода со страницы (риск R7).
      session.teardown();
      sessionRef.current = null;
      bound?.clear();
      cache.clear();
      selfTrackRef.current = null;
      // Оверлей относится к конкретной сессии: после выхода он не нужен.
      setAudioBlocked(false);
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
    sendChatMessage: (text) => {
      void sessionRef.current?.sendChatMessage(text);
    },
    audioBlocked,
    enableAudio,
    attachVideo,
  };
}
