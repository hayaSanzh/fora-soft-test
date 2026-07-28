/**
 * Единственная точка создания соединения с сигнальным сервером
 * (задача IP 6.1, TDD §4.1).
 *
 * Каждая опция здесь — следствие требования, а не вкусовая настройка:
 *
 * - **`reconnection: false`** (ФТ-31, US-11). Автопереподключение запрещено
 *   требованием. Оставить его включённым нельзя не только «формально»:
 *   socket.io переподключился бы с **новым** `socket.id`, а на сервере до
 *   истечения ping-таймаута остался бы фантомный участник, занимающий слот.
 * - **`autoConnect: false`.** Подключаемся только после ввода имени и попытки
 *   получить медиа — иначе сокет висит на стартовом экране и занимает слот
 *   раньше, чем пользователь решил войти.
 * - **`transports: ['websocket']`** (TDD §9.3). Без апгрейда с long-polling:
 *   экономит round-trip на старте.
 * - **`timeout`** (8 000 мс). Истечение ведёт на экран ошибки сервера (ФТ-35).
 */
import { io, type Socket } from 'socket.io-client';
import {
  SOCKET_PATH,
  type ClientToServerEvents,
  type JoinAck,
  type JoinPayload,
  type ServerToClientEvents,
} from '@video-chat/shared';
import { config } from '../config';

/** Типизированный клиентский сокет: направления событий здесь зеркальны серверу. */
export type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export interface CreateSocketOptions {
  /** Адрес сервера. Пустая строка (дефолт) означает тот же origin, что и страница. */
  url?: string;
  timeoutMs?: number;
}

export function createSocket(options: CreateSocketOptions = {}): ClientSocket {
  const url = options.url ?? config.socketUrl;
  const opts = {
    path: SOCKET_PATH,
    // Массив изменяемый намеренно: типы socket.io-client не принимают readonly.
    transports: ['websocket'],
    reconnection: false,
    autoConnect: false,
    timeout: options.timeoutMs ?? config.socketTimeoutMs,
  };

  // Пустой url → socket.io берёт origin страницы. Явный undefined обязателен:
  // io('') подключился бы к текущему пути, а не к origin.
  return url === '' ? io(opts) : io(url, opts);
}

/** Результат попытки войти в комнату: ответ сервера либо факт молчания. */
export type JoinOutcome = { status: 'ack'; ack: JoinAck } | { status: 'timeout' };

/**
 * Отправляет `room:join` и ждёт ack (задача 6.2).
 *
 * Таймаут обязателен: без него клиент, отправивший `join` в момент падения
 * сервера, остался бы на экране «Подключаемся…» навсегда. Молчание сервера
 * трактуется так же, как ошибка соединения (ФТ-35).
 */
export async function joinRoom(
  socket: ClientSocket,
  payload: JoinPayload,
  timeoutMs: number = config.socketTimeoutMs,
): Promise<JoinOutcome> {
  try {
    // `socket.timeout()` теряет типизацию событий в socket.io-client, поэтому
    // форма ответа возвращается к контракту явным приведением.
    const ack = (await socket.timeout(timeoutMs).emitWithAck('room:join', payload)) as JoinAck;
    return { status: 'ack', ack };
  } catch {
    // emitWithAck отклоняется ровно по таймауту ack — иных причин у него нет.
    return { status: 'timeout' };
  }
}
