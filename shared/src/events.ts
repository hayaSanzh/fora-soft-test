/**
 * Контракт Socket.io (задача IP 2.2, TDD §6.2).
 *
 * Интерфейсы описаны в форме, которую понимает сам socket.io
 * (`Server<ClientToServerEvents, ServerToClientEvents, …>`), поэтому опечатка в
 * имени события или лишний аргумент — ошибка компиляции на обеих сторонах.
 *
 * Типы SDP и ICE описаны структурно, без зависимости от `lib.dom`: серверу DOM
 * недоступен, а браузерные `RTCSessionDescriptionInit` / `RTCIceCandidateInit`
 * присваиваются им без приведения — формы совпадают.
 */

import type { ChatItem, MediaState, Participant, RoomSnapshot } from './types.js';

// ─── Транспортные представления WebRTC ───────────────────────────────────────

/** Структурный аналог `RTCSessionDescriptionInit`. */
export interface SdpDescription {
  type: 'offer' | 'answer' | 'pranswer' | 'rollback';
  sdp?: string;
}

/** Структурный аналог `RTCIceCandidateInit`. */
export interface IceCandidateData {
  candidate?: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

// ─── Ошибки ──────────────────────────────────────────────────────────────────

/** Ошибки ack `room:join` (TDD §6.2, §8.1). */
export const JOIN_ERRORS = [
  /** ФТ-8: 5-й участник. Экран «Комната заполнена» + кнопка повтора. */
  'ROOM_FULL',
  /** US-1: не должно случаться — клиент валидирует первым (TDD §8.1). */
  'INVALID_NAME',
  /** Мусорный `roomId` в ссылке → «Некорректная ссылка» и редирект на `/`. */
  'INVALID_ROOM_ID',
  /** Повторный `room:join` в одном сокете: признак ошибки в клиенте. */
  'ALREADY_JOINED',
] as const;

export type JoinError = (typeof JOIN_ERRORS)[number];

/** Ошибки ack `chat:message` (TDD §6.2, §8.1). */
export const CHAT_ERRORS = [
  /** ФТ-24: пустое сообщение или одни пробелы. */
  'EMPTY_TEXT',
  /** Q7: превышен лимит длины. */
  'TEXT_TOO_LONG',
  /** ФТ-40: token bucket. Сокет **не рвётся**, ввод не очищается. */
  'RATE_LIMITED',
  /** Сокет не прошёл `room:join` (TDD §4.3). */
  'NOT_IN_ROOM',
] as const;

export type ChatError = (typeof CHAT_ERRORS)[number];

// ─── Payload'ы и ack ─────────────────────────────────────────────────────────

export interface JoinPayload {
  roomId: string;
  name: string;
  /** Состояние устройств на момент входа: поздний участник увидит его сразу (ФТ-14). */
  media: MediaState;
}

/**
 * Ответ на `room:join` приходит **ack-колбэком**, а не отдельным событием:
 * ответ жёстко привязан к запросу, а лимит участников проверяется и
 * подтверждается в одном синхронном такте event loop (ФТ-7, TDD §6.2, §7.2).
 */
export type JoinAck =
  { ok: true; self: Participant; room: RoomSnapshot } | { ok: false; error: JoinError };

export type ChatAck = { ok: true; id: string } | { ok: false; error: ChatError };

/** Исходящий сигналинг: адресат обязателен, `from` подставляет сервер. */
export interface SignalOfferOut {
  to: string;
  sdp: SdpDescription;
}
export interface SignalAnswerOut {
  to: string;
  sdp: SdpDescription;
}
export interface SignalIceOut {
  to: string;
  candidate: IceCandidateData;
}

/** Входящий сигналинг: `from` подставлен сервером и не приходит от клиента. */
export interface SignalOfferIn {
  from: string;
  sdp: SdpDescription;
}
export interface SignalAnswerIn {
  from: string;
  sdp: SdpDescription;
}
export interface SignalIceIn {
  from: string;
  candidate: IceCandidateData;
}

export interface ChatMessagePayload {
  text: string;
}

export interface PeerJoinedPayload {
  participant: Participant;
}

/** Выход, закрытие вкладки и обрыв — одно и то же событие (ФТ-31, TDD §8.4). */
export interface PeerLeftPayload {
  id: string;
  name: string;
}

export interface MediaStatePayload {
  id: string;
  media: MediaState;
}

// ─── События ─────────────────────────────────────────────────────────────────

/** Клиент → сервер (TDD §6.2). */
export interface ClientToServerEvents {
  'room:join': (payload: JoinPayload, ack: (result: JoinAck) => void) => void;
  /** Идемпотентно: повторный вызов и вызов без входа в комнату безвредны. */
  'room:leave': () => void;
  /** Молча отбрасывается, если `to` — не участник той же комнаты (TDD §4.3). */
  'signal:offer': (payload: SignalOfferOut) => void;
  'signal:answer': (payload: SignalAnswerOut) => void;
  'signal:ice': (payload: SignalIceOut) => void;
  /** ФТ-15…18: явная передача состояния устройств вместо догадок по WebRTC. */
  'media:state': (payload: MediaState) => void;
  'chat:message': (payload: ChatMessagePayload, ack: (result: ChatAck) => void) => void;
}

/** Сервер → клиент (TDD §6.2). */
export interface ServerToClientEvents {
  'peer:joined': (payload: PeerJoinedPayload) => void;
  'peer:left': (payload: PeerLeftPayload) => void;
  'signal:offer': (payload: SignalOfferIn) => void;
  'signal:answer': (payload: SignalAnswerIn) => void;
  'signal:ice': (payload: SignalIceIn) => void;
  'media:state': (payload: MediaStatePayload) => void;
  /** И пользовательские, и системные сообщения — одним событием (ФТ-25). */
  'chat:message': (item: ChatItem) => void;
}

/** Событий между инстансами нет: сервер запускается в одном экземпляре (TDD §9.4). */
export type InterServerEvents = Record<string, never>;

/**
 * Данные, привязанные к сокету на сервере.
 * `roomId` — источник истины «где сокет»; ставится **только** в `room:join`,
 * его отсутствие и означает `NOT_IN_ROOM` (TDD §4.3).
 */
export interface SocketData {
  roomId?: string;
}

// ─── Списки имён событий ─────────────────────────────────────────────────────

export const CLIENT_EVENTS = [
  'room:join',
  'room:leave',
  'signal:offer',
  'signal:answer',
  'signal:ice',
  'media:state',
  'chat:message',
] as const satisfies readonly (keyof ClientToServerEvents)[];

export const SERVER_EVENTS = [
  'peer:joined',
  'peer:left',
  'signal:offer',
  'signal:answer',
  'signal:ice',
  'media:state',
  'chat:message',
] as const satisfies readonly (keyof ServerToClientEvents)[];

/**
 * Списки выше обязаны покрывать интерфейсы целиком: добавленное событие,
 * не попавшее в список, ломает компиляцию здесь, а не в тестах группы 4.
 */
type Missing<TEvents, TListed extends string> = Exclude<keyof TEvents, TListed>;
type AssertNever<T extends never> = T;

export type _AllClientEventsListed = AssertNever<
  Missing<ClientToServerEvents, (typeof CLIENT_EVENTS)[number]>
>;
export type _AllServerEventsListed = AssertNever<
  Missing<ServerToClientEvents, (typeof SERVER_EVENTS)[number]>
>;
