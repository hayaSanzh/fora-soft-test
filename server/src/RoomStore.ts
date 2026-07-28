/**
 * `RoomStore` — единственный владелец состояния комнат (задача IP 3, TDD §4.2).
 *
 * Три свойства, за которые отвечает именно этот модуль:
 *
 * 1. **Комната создаётся по факту обращения** (ФТ-5). Состояния «комната не
 *    найдена» в системе не существует: любой валидный `roomId` из URL либо
 *    открывает существующую комнату, либо создаёт новую.
 * 2. **Лимит участников проверяется атомарно** (ФТ-7 / F-05). См. `join()`.
 * 3. **Комната умирает вместе с последним участником** (ФТ-9), мгновенно и
 *    вместе с историей чата: перезагрузка страницы не должна «наследовать»
 *    переписку.
 *
 * БД нет по требованию PRD, поэтому это и есть весь слой данных проекта.
 */
import { nanoid } from 'nanoid';
import {
  MESSAGE_ID_LENGTH,
  type ChatItem,
  type MediaState,
  type Participant,
  type RoomSnapshot,
  type SystemChatItem,
  type SystemMessageKind,
  type UserChatItem,
} from '@video-chat/shared';
import { config } from './config.js';

/** Комната в памяти процесса (TDD §4.2, §5.2). */
export interface Room {
  id: string;
  /** `Map` по `socket.id`: удаление при `disconnect` — O(1), ключ уникален. */
  participants: Map<string, Participant>;
  /** Ring buffer ≤ `maxMessages` (ФТ-23). */
  messages: ChatItem[];
  createdAt: number;
}

export type JoinResult =
  | { ok: true; room: Room; self: Participant }
  | { ok: false; error: 'ROOM_FULL' | 'ALREADY_JOINED' };

/** Заготовка сообщения: `id` и `ts` проставляет стор — они серверные (ФТ-22). */
export type ChatDraft =
  | { type: 'user'; authorId: string; authorName: string; text: string }
  | { type: 'system'; kind: SystemMessageKind; name: string };

export interface RoomStoreOptions {
  maxParticipants?: number;
  maxMessages?: number;
  /** Источник времени; подменяется в тестах. */
  now?: () => number;
  /** Генератор `messageId`; подменяется в тестах. */
  generateId?: () => string;
}

export interface RoomStoreStats {
  rooms: number;
  participants: number;
}

export class RoomStore {
  private readonly rooms = new Map<string, Room>();
  private readonly maxParticipants: number;
  private readonly maxMessages: number;
  private readonly now: () => number;
  private readonly generateId: () => string;

  constructor(options: RoomStoreOptions = {}) {
    this.maxParticipants = options.maxParticipants ?? config.maxParticipants;
    this.maxMessages = options.maxMessages ?? config.maxMessages;
    this.now = options.now ?? Date.now;
    this.generateId = options.generateId ?? (() => nanoid(MESSAGE_ID_LENGTH));
  }

  /** Комната или `undefined`. Не создаёт: для создания есть `createIfAbsent`. */
  get(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  /**
   * Возвращает комнату, создавая её при первом обращении (ФТ-5, ФТ-6).
   * Именно поэтому в контракте нет ошибки «комната не найдена».
   */
  createIfAbsent(roomId: string): Room {
    const existing = this.rooms.get(roomId);
    if (existing) return existing;
    const room: Room = {
      id: roomId,
      participants: new Map(),
      messages: [],
      createdAt: this.now(),
    };
    this.rooms.set(roomId, room);
    return room;
  }

  /**
   * ★ **Атомарный вход** (ФТ-7 / F-05, US-5, TDD §7.2).
   *
   * Функция **строго синхронна**: между проверкой размера комнаты и вставкой
   * участника нет ни одного `await`, `process.nextTick`, `setTimeout` или
   * любого другого выхода в event loop. Однопоточность Node.js делает этот
   * участок критической секцией бесплатно, поэтому гонка за последний слот
   * решается без мьютексов и без счётчиков в Redis.
   *
   * **Любое добавление `await` внутрь этой функции ломает требование F-05.**
   * Это закреплено тестом: 10 одновременных `join` в одном тике впускают
   * ровно `maxParticipants` участников, и отдельным тестом-стражем, который
   * проверяет, что в теле метода нет `await`.
   */
  join(roomId: string, socketId: string, name: string, media: MediaState): JoinResult {
    const room = this.createIfAbsent(roomId);

    // Один сокет = один слот. Повторный вход тем же сокетом — ошибка клиента,
    // а не способ занять второе место (ФТ-29: отдельная вкладка = отдельный сокет).
    if (room.participants.has(socketId)) {
      return { ok: false, error: 'ALREADY_JOINED' };
    }

    if (room.participants.size >= this.maxParticipants) {
      // Защита от конфигурации `maxParticipants: 0`: пустая комната, созданная
      // выше, не должна остаться в памяти навсегда.
      if (room.participants.size === 0) this.rooms.delete(roomId);
      return { ok: false, error: 'ROOM_FULL' };
    }

    const self: Participant = { id: socketId, name, media, joinedAt: this.now() };
    room.participants.set(socketId, self);
    return { ok: true, room, self };
  }

  /**
   * Выход участника (ФТ-9, ФТ-27, US-10).
   *
   * При падении счётчика до нуля комната удаляется **немедленно**, без
   * grace-периода: иначе перезагрузка страницы унаследовала бы историю чата,
   * что противоречит ФТ-9 и правилу «перезагрузка = новый вход».
   *
   * @returns удалённый участник или `null`, если его (или комнаты) не было.
   */
  leave(roomId: string, socketId: string): Participant | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    const participant = room.participants.get(socketId) ?? null;
    room.participants.delete(socketId);

    // ★ Вместе с комнатой исчезают и её id, и вся история чата.
    if (room.participants.size === 0) this.rooms.delete(roomId);

    return participant;
  }

  /** Участник комнаты или `undefined` — основа проверки адресата сигналинга (TDD §4.3). */
  getParticipant(roomId: string, socketId: string): Participant | undefined {
    return this.rooms.get(roomId)?.participants.get(socketId);
  }

  /**
   * Обновляет состояние устройств участника (ФТ-15…18).
   *
   * Хранить его обязательно: поздний участник получает актуальное состояние в
   * снапшоте и сразу видит заглушку камеры, а не «чёрный экран без причины»
   * (TDD §4.4).
   */
  updateMedia(roomId: string, socketId: string, media: MediaState): boolean {
    const participant = this.rooms.get(roomId)?.participants.get(socketId);
    if (!participant) return false;
    participant.media = media;
    return true;
  }

  /**
   * Добавляет сообщение в историю комнаты (ФТ-21…23, ФТ-25).
   *
   * `id` и `ts` проставляются здесь: время обязано быть серверным (ФТ-22
   * говорит про локальное время **отображения**, а не про источник), а `id`
   * нужен как React-key и для идемпотентности.
   *
   * История — ring buffer: без потолка комната живёт неограниченно долго и
   * растёт в памяти. Поздний участник получает последние `maxMessages` — этого
   * достаточно для требования «видит сообщения до входа».
   *
   * @returns добавленный элемент или `null`, если комнаты нет.
   */
  addMessage(roomId: string, draft: ChatDraft): ChatItem | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    const item: ChatItem = { ...draft, id: this.generateId(), ts: this.now() };

    room.messages.push(item);
    if (room.messages.length > this.maxMessages) {
      room.messages.splice(0, room.messages.length - this.maxMessages);
    }
    return item;
  }

  /** Сообщение участника (ФТ-21). */
  addUserMessage(roomId: string, author: Participant, text: string): UserChatItem | null {
    const item = this.addMessage(roomId, {
      type: 'user',
      authorId: author.id,
      authorName: author.name,
      text,
    });
    return item?.type === 'user' ? item : null;
  }

  /** Системное сообщение о входе/выходе (ФТ-25). */
  addSystemMessage(roomId: string, kind: SystemMessageKind, name: string): SystemChatItem | null {
    const item = this.addMessage(roomId, { type: 'system', kind, name });
    return item?.type === 'system' ? item : null;
  }

  /**
   * Снапшот для ack `room:join` (TDD §6.2): участники + история одним ответом,
   * вместо трёх round-trip'ов.
   *
   * Возвращает копии массивов: внешний код не должен уметь менять состояние
   * комнаты в обход стора.
   */
  snapshot(roomId: string): RoomSnapshot | undefined {
    const room = this.rooms.get(roomId);
    if (!room) return undefined;
    return {
      id: room.id,
      participants: [...room.participants.values()],
      messages: [...room.messages],
    };
  }

  /** Счётчики для `GET /health` (TDD §6.1). */
  stats(): RoomStoreStats {
    let participants = 0;
    for (const room of this.rooms.values()) participants += room.participants.size;
    return { rooms: this.rooms.size, participants };
  }
}
