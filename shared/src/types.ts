/**
 * Типы данных контракта (задача IP 2.1, TDD §5.2).
 *
 * Один источник истины для клиента и сервера: и снапшот комнаты, и события
 * presence, и история чата описаны здесь, поэтому «сервер прислал не то, что
 * ждал клиент» становится ошибкой компиляции, а не ошибкой на демонстрации.
 */

/**
 * Состояние устройств участника (ФТ-15…18).
 *
 * ★ Это **единственный** источник истины для отрисовки заглушки камеры и
 * иконки перечёркнутого микрофона. По WebRTC достоверно узнать, что собеседник
 * выключил камеру, нельзя: событие `mute` у remote track необязательно и
 * приходит с задержкой, а `replaceTrack(null)` вообще не меняет SDP (TDD §4.4).
 */
export interface MediaState {
  audio: boolean;
  video: boolean;
}

/** Участник комнаты (TDD §5.2). */
export interface Participant {
  /** `socket.id`. Уникален в пределах процесса и **не показывается в UI** (ФТ-30). */
  id: string;
  /** Отображаемое имя: 1..30 символов, прошло валидацию (ФТ-38). */
  name: string;
  media: MediaState;
  /** epoch ms. Нужен для стабильного порядка плиток. */
  joinedAt: number;
}

/** Причина системного сообщения (ФТ-25). */
export type SystemMessageKind =
  | 'join'
  /** Один текст и на выход, и на обрыв: сервер их не различает (ФТ-31, TDD §8.4). */
  | 'leave'
  /** Плановое завершение работы сервера (Q10, TDD §12.4). */
  | 'shutdown';

/** Сообщение чата от участника (ФТ-21, ФТ-22). */
export interface UserChatItem {
  type: 'user';
  /** `nanoid(10)`, генерируется сервером: React-key и идемпотентность. */
  id: string;
  authorId: string;
  /**
   * Имя автора копируется **в сообщение**, а не берётся из списка участников:
   * иначе сообщение ушедшего участника осталось бы без автора (TDD §8.2).
   */
  authorName: string;
  /** Текст как есть, без экранирования. Экранирование — только на выходе (TDD §10.3). */
  text: string;
  /** Серверный epoch ms; «HH:MM» вычисляет клиент по своей локали (ФТ-22). */
  ts: number;
}

/** Системное сообщение о входе/выходе (ФТ-25). */
export interface SystemChatItem {
  type: 'system';
  id: string;
  kind: SystemMessageKind;
  /** Имя участника, о котором сообщение; для `shutdown` — пустая строка. */
  name: string;
  ts: number;
}

/**
 * Элемент истории чата — discriminated union по `type`.
 *
 * Системные сообщения намеренно лежат в том же ring buffer, что и
 * пользовательские: так они переигрываются позднему участнику и рендерятся
 * одним компонентом (TDD §6.2).
 */
export type ChatItem = UserChatItem | SystemChatItem;

/** Полный снапшот комнаты, отдаваемый в ack `room:join` (TDD §6.2). */
export interface RoomSnapshot {
  id: string;
  /** Включая самого вошедшего. */
  participants: Participant[];
  /** Последние ≤ `MAX_MESSAGES` элементов истории (ФТ-23). */
  messages: ChatItem[];
}

/** Сужение union: пользовательское сообщение. */
export function isUserChatItem(item: ChatItem): item is UserChatItem {
  return item.type === 'user';
}

/** Сужение union: системное сообщение. */
export function isSystemChatItem(item: ChatItem): item is SystemChatItem {
  return item.type === 'system';
}
