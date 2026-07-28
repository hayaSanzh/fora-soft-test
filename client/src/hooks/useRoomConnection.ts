/**
 * React-обёртка над жизненным циклом соединения (задачи IP 6.2, 6.3).
 *
 * Вся логика живёт в `services/roomConnection.ts`; здесь только привязка к
 * жизненному циклу компонента. В группе 9 этот хук поглощается
 * `useRoomSession`, который добавит `PeerManager` и подписки на сигналинг.
 */
import { useEffect, useRef, type Dispatch } from 'react';
import type { MediaState, Participant } from '@video-chat/shared';
import type { RoomAction } from '../state/roomReducer';
import { startRoomConnection, type RoomConnection } from '../services/roomConnection';
import type { ClientSocket } from '../services/socket';

export interface UseRoomConnectionOptions {
  /** Подключаться только когда экран действительно этого требует (`connecting`). */
  enabled: boolean;
  roomId: string;
  name: string;
  media: MediaState;
  dispatch: Dispatch<RoomAction>;
  onInvalidRoomId: () => void;
  teardownMedia?: () => void;
  /** Шов для группы 9: создание и закрытие `RTCPeerConnection` на участника. */
  onPeerJoined?: (participant: Participant) => void;
  onPeerLeft?: (participantId: string) => void;
  createSocketFn?: () => ClientSocket;
}

export interface UseRoomConnectionResult {
  leave: () => void;
  /** Разослать своё состояние устройств остальным (ФТ-15…18). */
  setMediaState: (media: MediaState) => void;
}

export function useRoomConnection(options: UseRoomConnectionOptions): UseRoomConnectionResult {
  const connectionRef = useRef<RoomConnection | null>(null);
  // Актуальные зависимости держим в ref: пересоздавать соединение из-за смены
  // колбэка нельзя — это разорвало бы живой звонок.
  const latest = useRef(options);
  latest.current = options;

  useEffect(() => {
    if (!options.enabled) return;

    const connection = startRoomConnection({
      roomId: latest.current.roomId,
      name: latest.current.name,
      media: latest.current.media,
      dispatch: (action) => latest.current.dispatch(action),
      onInvalidRoomId: () => latest.current.onInvalidRoomId(),
      teardownMedia: () => latest.current.teardownMedia?.(),
      onPeerJoined: (participant) => latest.current.onPeerJoined?.(participant),
      onPeerLeft: (participantId) => latest.current.onPeerLeft?.(participantId),
      ...(latest.current.createSocketFn ? { createSocketFn: latest.current.createSocketFn } : {}),
    });
    connectionRef.current = connection;

    return () => {
      // Размонтирование = выход: закрываем сокет и освобождаем медиа (риск R7).
      connection.dispose();
      connectionRef.current = null;
    };
    // Соединение создаётся ровно один раз на «включение»: остальные поля
    // читаются через ref, иначе смена колбэка пересоздавала бы сокет и рвала
    // живой звонок.
  }, [options.enabled, options.roomId]);

  return {
    leave: () => connectionRef.current?.leave(),
    setMediaState: (media) => connectionRef.current?.setMediaState(media),
  };
}
