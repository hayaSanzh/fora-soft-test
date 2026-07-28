/**
 * Обработчики событий Socket.io (задачи IP 4.1–4.7, TDD §4.3, §6.2, §7.1, §7.4, §7.5).
 *
 * Правила, которым подчинён весь файл:
 *
 * 1. **Ни одного `await` до ответа на `room:join`.** Атомарность лимита живёт в
 *    `RoomStore.join`, и обработчик не имеет права разрывать этот такт event
 *    loop (ФТ-7 / F-05).
 * 2. **`socket.data.roomId` — единственный источник истины «где сокет».**
 *    Ставится только в `room:join`; его отсутствие и есть `NOT_IN_ROOM`.
 * 3. **Сигналинг проверяет принадлежность адресата к той же комнате.** Без
 *    этого любой клиент инжектирует SDP/ICE в чужую комнату по угаданному id.
 * 4. **Ничего пользовательского в логах**: ни имён, ни текста (TDD §10.5).
 */
import {
  makeNameSchema,
  makeTextSchema,
  mediaStateSchema,
  roomIdSchema,
  validate,
  type JoinAck,
  type JoinPayload,
  type MediaState,
} from '@video-chat/shared';
import { config } from '../config.js';
import { logger as defaultLogger, type Logger } from '../logger.js';
import { createSocketLimits, type Clock } from '../rateLimiter.js';
import type { RoomStore } from '../RoomStore.js';
import type { TypedServer, TypedSocket } from './types.js';

export interface SocketHandlersOptions {
  maxNameLen?: number;
  maxMessageLen?: number;
  chatBurst?: number;
  chatRefillPerSec?: number;
  signalMax?: number;
  signalWindowMs?: number;
  /** Источник времени для лимитеров; подменяется в тестах. */
  now?: Clock;
  logger?: Logger;
}

/** Состояние медиа по умолчанию, если клиент прислал мусор вместо `MediaState`. */
const MEDIA_OFF: MediaState = { audio: false, video: false };

export function registerSocketHandlers(
  io: TypedServer,
  rooms: RoomStore,
  options: SocketHandlersOptions = {},
): void {
  const log = options.logger ?? defaultLogger;
  const nameSchema = makeNameSchema(options.maxNameLen ?? config.maxNameLen);
  const textSchema = makeTextSchema(options.maxMessageLen ?? config.maxMessageLen);

  io.on('connection', (socket: TypedSocket) => {
    // Лимитеры создаются на соединение: чистить их при disconnect не нужно,
    // они умирают вместе с замыканием обработчиков.
    const limits = createSocketLimits({
      chatBurst: options.chatBurst ?? config.chatRateBurst,
      chatRefillPerSec: options.chatRefillPerSec ?? config.chatRateRefillPerSec,
      signalMax: options.signalMax ?? config.signalRateMax,
      signalWindowMs: options.signalWindowMs ?? config.signalRateWindowMs,
      ...(options.now ? { now: options.now } : {}),
    });

    // ─── 4.1 room:join ───────────────────────────────────────────────────────
    socket.on('room:join', (payload: JoinPayload, ack: (result: JoinAck) => void) => {
      if (typeof ack !== 'function') {
        // Клиент без ack не сможет узнать результат; молча игнорируем запрос.
        log.warn({ socketId: socket.id }, 'room:join без ack-колбэка');
        return;
      }
      if (socket.data.roomId !== undefined) {
        ack({ ok: false, error: 'ALREADY_JOINED' });
        return;
      }

      const raw: Partial<JoinPayload> =
        payload !== null && typeof payload === 'object' ? payload : {};

      const room = validate(roomIdSchema, raw.roomId);
      if (!room.ok) {
        ack({ ok: false, error: 'INVALID_ROOM_ID' });
        return;
      }
      const name = validate(nameSchema, raw.name);
      if (!name.ok) {
        ack({ ok: false, error: 'INVALID_NAME' });
        return;
      }
      // Состояние устройств не критично для безопасности: мусор трактуем как
      // «оба выключены», а не отказываем во входе (ФТ-14 — вход без устройств).
      const media = validate(mediaStateSchema, raw.media);

      // ★ Ниже и до ack — ни одного await: критическая секция лимита (F-05).
      const result = rooms.join(
        room.value,
        socket.id,
        name.value,
        media.ok ? media.value : MEDIA_OFF,
      );
      if (!result.ok) {
        ack({ ok: false, error: result.error });
        return;
      }

      socket.data.roomId = room.value;
      void socket.join(room.value);

      // Полный снапшот одним ответом: участники + история + self (TDD §6.2).
      // Снимается ДО системного сообщения о входе, иначе вошедший получил бы
      // его дважды — в снапшоте и событием ниже.
      const snapshot = rooms.snapshot(room.value);
      ack({
        ok: true,
        self: result.self,
        room: snapshot ?? { id: room.value, participants: [], messages: [] },
      });

      socket.to(room.value).emit('peer:joined', { participant: result.self });

      const system = rooms.addSystemMessage(room.value, 'join', result.self.name);
      if (system) io.to(room.value).emit('chat:message', system);

      log.info(
        { socketId: socket.id, roomId: room.value, size: result.room.participants.size },
        'room:join',
      );
    });

    // ─── 4.2 guard NOT_IN_ROOM ───────────────────────────────────────────────
    /**
     * Сокет, не прошедший `room:join`, игнорируется всеми остальными
     * обработчиками. Это защита от подключений «в обход» сценария: без неё
     * можно слать сигналинг и сообщения, не занимая слот в комнате.
     */
    const currentRoom = (event: string): string | undefined => {
      const roomId = socket.data.roomId;
      if (roomId === undefined) {
        log.debug({ socketId: socket.id, event }, 'NOT_IN_ROOM: событие отброшено');
        return undefined;
      }
      return roomId;
    };

    // ─── 4.3 room:leave и disconnect — единый путь ───────────────────────────
    /**
     * Выход, закрытие вкладки и обрыв соединения обрабатываются одинаково
     * (ФТ-27, ФТ-28, ФТ-31). В чат идёт «покинул комнату»: сервер физически не
     * может отличить закрытие вкладки от потери канала, поэтому формулировка
     * «соединение потеряно» была бы догадкой (TDD §8.4).
     */
    const handleLeave = (cause: 'room:leave' | 'disconnect'): void => {
      const roomId = socket.data.roomId;
      if (roomId === undefined) return;
      delete socket.data.roomId;

      const participant = rooms.leave(roomId, socket.id);
      if (!participant) return;

      socket.to(roomId).emit('peer:left', { id: socket.id, name: participant.name });

      // Комната могла исчезнуть вместе с последним участником — тогда
      // системное сообщение писать некуда и некому (ФТ-9).
      const system = rooms.addSystemMessage(roomId, 'leave', participant.name);
      if (system) socket.to(roomId).emit('chat:message', system);

      void socket.leave(roomId);
      log.info({ socketId: socket.id, roomId, cause }, 'участник покинул комнату');
    };

    socket.on('room:leave', () => handleLeave('room:leave'));
    socket.on('disconnect', () => handleLeave('disconnect'));

    // ─── 4.7 лимит сигналинга ────────────────────────────────────────────────
    /** `false` = лимит превышен, сокет уже отключён. */
    const allowSignal = (): boolean => {
      if (limits.signal.tryHit()) return true;
      log.warn({ socketId: socket.id }, 'превышен лимит сигналинга: сокет отключён');
      socket.disconnect(true);
      return false;
    };

    // ─── 4.4 релей сигналинга ────────────────────────────────────────────────
    /**
     * Проверяет, что адресат — участник **той же** комнаты. Несовпадение —
     * молчаливый отброс: отвечать «такого участника нет» значит подтверждать
     * существование чужих socket.id.
     */
    const resolveTarget = (event: string, to: unknown): string | undefined => {
      const roomId = currentRoom(event);
      if (roomId === undefined) return undefined;
      if (typeof to !== 'string' || to.length === 0) return undefined;
      if (!rooms.getParticipant(roomId, to)) {
        log.debug({ socketId: socket.id, event }, 'сигналинг чужому адресату отброшен');
        return undefined;
      }
      return to;
    };

    socket.on('signal:offer', (payload) => {
      if (!allowSignal()) return;
      const to = resolveTarget('signal:offer', payload?.to);
      if (to === undefined || !payload?.sdp) return;
      io.to(to).emit('signal:offer', { from: socket.id, sdp: payload.sdp });
    });

    socket.on('signal:answer', (payload) => {
      if (!allowSignal()) return;
      const to = resolveTarget('signal:answer', payload?.to);
      if (to === undefined || !payload?.sdp) return;
      io.to(to).emit('signal:answer', { from: socket.id, sdp: payload.sdp });
    });

    socket.on('signal:ice', (payload) => {
      if (!allowSignal()) return;
      const to = resolveTarget('signal:ice', payload?.to);
      if (to === undefined || !payload?.candidate) return;
      io.to(to).emit('signal:ice', { from: socket.id, candidate: payload.candidate });
    });

    // ─── 4.5 media:state ─────────────────────────────────────────────────────
    /**
     * Состояние хранится в сторе, а не только ретранслируется: поздний
     * участник обязан получить актуальное состояние в снапшоте, иначе увидит
     * чёрный квадрат вместо заглушки камеры (ФТ-18, TDD §4.4).
     */
    socket.on('media:state', (payload) => {
      const roomId = currentRoom('media:state');
      if (roomId === undefined) return;

      const media = validate(mediaStateSchema, payload);
      if (!media.ok) {
        log.debug({ socketId: socket.id }, 'media:state с некорректным payload отброшен');
        return;
      }
      if (!rooms.updateMedia(roomId, socket.id, media.value)) return;

      socket.to(roomId).emit('media:state', { id: socket.id, media: media.value });
    });

    // ─── 4.6 chat:message ────────────────────────────────────────────────────
    /**
     * Broadcast идёт **всем, включая автора** (`io.to`, а не `socket.to`):
     * оптимистичного локального дубля на клиенте нет, поэтому порядок
     * сообщений у всех участников одинаковый и определяется сервером (TDD §7.5).
     */
    socket.on('chat:message', (payload, ack) => {
      const respond = typeof ack === 'function' ? ack : () => undefined;

      const roomId = currentRoom('chat:message');
      if (roomId === undefined) {
        respond({ ok: false, error: 'NOT_IN_ROOM' });
        return;
      }
      if (!limits.chat.tryConsume()) {
        // Сокет НЕ рвём: это человек, который торопится (ФТ-40).
        respond({ ok: false, error: 'RATE_LIMITED' });
        return;
      }

      const text = validate(textSchema, payload?.text);
      if (!text.ok) {
        // Схема различает пустой текст и превышение длины: клиент показывает
        // разные подсказки, поэтому код нельзя схлопывать в один (TDD §8.1).
        respond({
          ok: false,
          error: text.error === 'TEXT_TOO_LONG' ? 'TEXT_TOO_LONG' : 'EMPTY_TEXT',
        });
        return;
      }

      const author = rooms.getParticipant(roomId, socket.id);
      if (!author) {
        respond({ ok: false, error: 'NOT_IN_ROOM' });
        return;
      }

      const item = rooms.addUserMessage(roomId, author, text.value);
      if (!item) {
        respond({ ok: false, error: 'NOT_IN_ROOM' });
        return;
      }

      io.to(roomId).emit('chat:message', item);
      respond({ ok: true, id: item.id });
    });
  });
}
