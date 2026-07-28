/**
 * Жизненный цикл соединения с комнатой (задачи IP 6.2, 6.3, TDD §4.1, §8.1, §8.3).
 *
 * Модуль намеренно **не знает про React**: это функция от зависимостей,
 * возвращающая объект с `leave()` и `dispose()`. Благодаря этому весь сценарий
 * входа и все ветки ошибок проверяются тестами без рендера компонентов, в том
 * числе на живом socket.io-сервере.
 *
 * Правило обработки ошибок (TDD §8.3):
 * - ошибка **сокета терминальна** — без сигналинга нет ни presence, ни чата,
 *   поэтому экран ошибки + полный teardown;
 * - `ROOM_FULL` терминален для попытки, но не для пользователя: с экрана
 *   «Комната заполнена» работает повтор входа (ФТ-8, US-5);
 * - `INVALID_ROOM_ID` означает битую ссылку → возврат на стартовый экран.
 */
import type { Dispatch } from 'react';
import type { JoinPayload, MediaState, Participant } from '@video-chat/shared';
import type { RoomAction } from '../state/roomReducer';
import { createSocket, joinRoom, type ClientSocket } from './socket';

export interface RoomConnectionDeps {
  roomId: string;
  name: string;
  /** Состояние устройств на момент входа; при отказе в доступе — оба `false` (ФТ-14). */
  media: MediaState;
  dispatch: Dispatch<RoomAction>;
  /** Битая ссылка: увести на стартовый экран (`INVALID_ROOM_ID`). */
  onInvalidRoomId: () => void;
  /**
   * Шов для группы 9: `useRoomSession` создаёт `RTCPeerConnection` на нового
   * участника и закрывает его на выходе. Presence-часть (список участников,
   * история чата) обновляется здесь и от WebRTC не зависит.
   */
  onPeerJoined?: (participant: Participant) => void;
  onPeerLeft?: (participantId: string) => void;
  /**
   * Полный teardown медиа: закрыть все `RTCPeerConnection` и остановить
   * дорожки. Реализация приходит из групп 7–9; здесь важно, что она
   * вызывается **на любом обрыве**, иначе камера продолжает работать после
   * выхода (риск R7).
   */
  teardownMedia?: () => void;
  /** Подменяется в тестах. */
  createSocketFn?: () => ClientSocket;
  timeoutMs?: number;
}

export interface RoomConnection {
  socket: ClientSocket;
  /**
   * Разослать своё состояние устройств (ФТ-15…18).
   *
   * Отправляется явным событием, а не выводится из WebRTC: по медиапотоку
   * достоверно узнать «камера выключена» нельзя (TDD §4.4).
   */
  setMediaState: (media: MediaState) => void;
  /** Осознанный выход участника: сообщаем серверу и закрываем соединение. */
  leave: () => void;
  /** Освобождение ресурсов при размонтировании. Идемпотентно. */
  dispose: () => void;
}

export function startRoomConnection(deps: RoomConnectionDeps): RoomConnection {
  const { roomId, name, media, dispatch, onInvalidRoomId } = deps;
  const socket = (deps.createSocketFn ?? (() => createSocket()))();

  /** Защита от повторной обработки: teardown и переходы должны случиться один раз. */
  let closed = false;

  const teardown = (): void => {
    if (closed) return;
    closed = true;
    deps.teardownMedia?.();
    socket.removeAllListeners();
    socket.disconnect();
  };

  /** Любая терминальная ошибка транспорта: один экран, один путь (ФТ-35, TDD §8.1). */
  const failToServerError = (): void => {
    if (closed) return;
    teardown();
    dispatch({ type: 'SERVER_ERROR' });
  };

  // ── 6.3 ошибки транспорта ──────────────────────────────────────────────────
  // `connect_error` и таймаут подключения приходят одним и тем же событием;
  // различать «сервер лежит» и «нет интернета» не требуется — текст один.
  socket.on('connect_error', failToServerError);

  socket.on('disconnect', (reason) => {
    // Собственный `disconnect()` в `teardown`/`leave` уже выставил `closed`,
    // поэтому сюда попадают только незапрошенные обрывы.
    if (reason === 'io client disconnect') return;
    failToServerError();
  });

  // ── Presence и чат: подписки на события комнаты ────────────────────────────
  /**
   * ★ Без этих подписок комната «мертва»: участник видит только себя, не узнаёт
   * ни о входе, ни о выходе других, и системные сообщения до него не доходят.
   * Требования ФТ-25, ФТ-26, ФТ-27, ФТ-31 держатся именно на них, а веха M1
   * прямо требует «список участников живой».
   *
   * Медиа-часть (создание `RTCPeerConnection` на нового участника и его
   * закрытие на выходе) подключается через колбэки `onPeerJoined`/`onPeerLeft`
   * в группе 9 — здесь этот слой намеренно ничего не знает про WebRTC.
   */
  socket.on('peer:joined', ({ participant }) => {
    dispatch({ type: 'PEER_JOINED', participant });
    deps.onPeerJoined?.(participant);
  });

  socket.on('peer:left', ({ id }) => {
    dispatch({ type: 'PEER_LEFT', id });
    deps.onPeerLeft?.(id);
  });

  // Единственный источник истины для заглушки камеры и иконки микрофона:
  // по WebRTC это узнать достоверно нельзя (TDD §4.4).
  socket.on('media:state', ({ id, media: peerMedia }) => {
    dispatch({ type: 'PEER_MEDIA', id, media: peerMedia });
  });

  // Пользовательские и системные сообщения приходят одним событием (ФТ-25).
  socket.on('chat:message', (item) => {
    dispatch({ type: 'CHAT_MESSAGE', item });
  });

  // ── 6.2 вход в комнату ─────────────────────────────────────────────────────
  socket.on('connect', () => {
    const payload: JoinPayload = { roomId, name, media };

    void joinRoom(socket, payload, deps.timeoutMs).then((outcome) => {
      if (closed) return;

      if (outcome.status === 'timeout') {
        // Сервер не ответил на join: для пользователя это то же, что «сервер
        // недоступен» (ФТ-35), а не бесконечный экран «Подключаемся…».
        failToServerError();
        return;
      }

      const { ack } = outcome;
      if (ack.ok) {
        dispatch({
          type: 'JOINED',
          selfId: ack.self.id,
          participants: ack.room.participants,
          messages: ack.room.messages,
        });
        return;
      }

      switch (ack.error) {
        case 'ROOM_FULL':
          // Соединение больше не нужно: слот не занят, а экран «Комната
          // заполнена» умеет повторить вход заново (ФТ-8, US-5).
          teardown();
          dispatch({ type: 'ROOM_FULL' });
          return;
        case 'INVALID_ROOM_ID':
          teardown();
          onInvalidRoomId();
          return;
        case 'INVALID_NAME':
        case 'ALREADY_JOINED':
          // Оба случая означают ошибку в клиенте: имя валидируется до отправки,
          // а повторный join в одном сокете невозможен по конструкции. Показываем
          // экран ошибки, чтобы дефект был заметен, а не проглочен.
          failToServerError();
          return;
      }
    });
  });

  socket.connect();

  return {
    socket,
    setMediaState: (next) => {
      if (closed || !socket.connected) return;
      socket.emit('media:state', next);
    },
    leave: () => {
      if (closed) return;
      // Сообщаем серверу до разрыва: остальные получат `peer:left` сразу,
      // не дожидаясь ping-таймаута (ФТ-27).
      socket.emit('room:leave');
      teardown();
      dispatch({ type: 'LEFT' });
    },
    dispose: teardown,
  };
}
