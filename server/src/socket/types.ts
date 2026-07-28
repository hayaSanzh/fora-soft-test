/**
 * Типизированные псевдонимы socket.io (задача IP 4.1).
 *
 * Благодаря генерикам из `shared/events.ts` сервер не может отправить событие
 * с неверным именем или payload — это ошибка компиляции, а не разбор логов
 * на демонстрации.
 */
import type { Server, Socket } from 'socket.io';
import type {
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
  SocketData,
} from '@video-chat/shared';

export type TypedServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

export type TypedSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;
