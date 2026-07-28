/**
 * Стенд для integration-тестов контракта (задачи IP 4.10, 4.11, TDD §11.3).
 *
 * Поднимает настоящий socket.io-сервер с настоящими обработчиками и настоящим
 * `RoomStore`: моков здесь нет намеренно — проверяется контракт целиком,
 * включая порядок событий и работу broadcast'ов.
 */
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server } from 'socket.io';
import { io as ioClient, type Socket as RawClientSocket } from 'socket.io-client';
import {
  SOCKET_PATH,
  type ClientToServerEvents,
  type InterServerEvents,
  type JoinAck,
  type MediaState,
  type ServerToClientEvents,
  type SocketData,
} from '@video-chat/shared';
import { RoomStore } from '../RoomStore.js';
import { registerSocketHandlers, type SocketHandlersOptions } from './socketHandlers.js';
import type { TypedServer } from './types.js';

export type TestClient = RawClientSocket<ServerToClientEvents, ClientToServerEvents>;

export const MEDIA_ON: MediaState = { audio: true, video: true };
export const MEDIA_OFF: MediaState = { audio: false, video: false };

/** Логгер-заглушка: тесты не должны засорять вывод. */
const silentLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
} as unknown as NonNullable<SocketHandlersOptions['logger']>;

export interface Harness {
  io: TypedServer;
  httpServer: HttpServer;
  rooms: RoomStore;
  url: string;
  /** Подключает клиента и ждёт `connect`. */
  connect: () => Promise<TestClient>;
  /** Подключается и входит в комнату; возвращает клиента и ack. */
  join: (
    roomId: string,
    name: string,
    media?: MediaState,
  ) => Promise<{
    client: TestClient;
    ack: JoinAck;
  }>;
  close: () => Promise<void>;
}

export interface HarnessOptions extends SocketHandlersOptions {
  maxParticipants?: number;
  maxMessages?: number;
}

export async function createHarness(options: HarnessOptions = {}): Promise<Harness> {
  const { maxParticipants, maxMessages, ...handlerOptions } = options;

  const httpServer = createServer();
  const io: TypedServer = new Server<
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData
  >(httpServer, { path: SOCKET_PATH, transports: ['websocket'] });

  let seq = 0;
  let tick = 0;
  const rooms = new RoomStore({
    ...(maxParticipants !== undefined ? { maxParticipants } : {}),
    ...(maxMessages !== undefined ? { maxMessages } : {}),
    generateId: () => `msg-${++seq}`,
    now: () => 1_769_000_000_000 + tick++,
  });

  registerSocketHandlers(io, rooms, { logger: silentLogger, ...handlerOptions });

  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const { port } = httpServer.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}`;

  const clients: TestClient[] = [];

  const connect = async (): Promise<TestClient> => {
    const client: TestClient = ioClient(url, {
      path: SOCKET_PATH,
      transports: ['websocket'],
      reconnection: false,
    });
    clients.push(client);
    await new Promise<void>((resolve, reject) => {
      client.on('connect', () => resolve());
      client.on('connect_error', reject);
    });
    return client;
  };

  const join: Harness['join'] = async (roomId, name, media = MEDIA_ON) => {
    const client = await connect();
    const ack: JoinAck = await client.emitWithAck('room:join', { roomId, name, media });
    return { client, ack };
  };

  const close = async (): Promise<void> => {
    for (const client of clients.splice(0)) client.disconnect();
    await io.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  };

  return { io, httpServer, rooms, url, connect, join, close };
}

/** Ждёт одно событие с таймаутом — иначе упавший тест висит до общего таймаута. */
export function waitFor<K extends keyof ServerToClientEvents>(
  client: TestClient,
  event: K,
  timeoutMs = 3_000,
): Promise<Parameters<ServerToClientEvents[K]>[0]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`событие ${String(event)} не пришло за ${timeoutMs} мс`)),
      timeoutMs,
    );
    client.once(event, ((payload: unknown) => {
      clearTimeout(timer);
      resolve(payload as Parameters<ServerToClientEvents[K]>[0]);
    }) as never);
  });
}

/**
 * Ждёт первое событие, удовлетворяющее условию.
 *
 * Нужен потому, что в комнате параллельно идут системные сообщения о входах:
 * «первое пришедшее chat:message» и «сообщение о выходе» — разные вещи, и
 * тест, подписанный на первое, оказался бы гоночным.
 */
export function waitForMatch<K extends keyof ServerToClientEvents>(
  client: TestClient,
  event: K,
  predicate: (payload: Parameters<ServerToClientEvents[K]>[0]) => boolean,
  timeoutMs = 3_000,
): Promise<Parameters<ServerToClientEvents[K]>[0]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`подходящее событие ${String(event)} не пришло за ${timeoutMs} мс`)),
      timeoutMs,
    );
    const handler = ((payload: unknown) => {
      const typed = payload as Parameters<ServerToClientEvents[K]>[0];
      if (!predicate(typed)) return;
      clearTimeout(timer);
      client.off(event, handler);
      resolve(typed);
    }) as never;
    client.on(event, handler);
  });
}

/** Даёт доехать событиям, отправленным до этого момента. */
export function settle(ms = 100): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Собирает N событий подряд — для проверки порядка доставки. */
export function collect<K extends keyof ServerToClientEvents>(
  client: TestClient,
  event: K,
  count: number,
  timeoutMs = 5_000,
): Promise<Parameters<ServerToClientEvents[K]>[0][]> {
  return new Promise((resolve, reject) => {
    const items: Parameters<ServerToClientEvents[K]>[0][] = [];
    const timer = setTimeout(
      () => reject(new Error(`получено ${items.length} из ${count} событий ${String(event)}`)),
      timeoutMs,
    );
    const handler = ((payload: unknown) => {
      items.push(payload as Parameters<ServerToClientEvents[K]>[0]);
      if (items.length === count) {
        clearTimeout(timer);
        client.off(event, handler);
        resolve(items);
      }
    }) as never;
    client.on(event, handler);
  });
}

/** Утверждение «событие НЕ приходит»: ждём окно и убеждаемся, что тишина. */
export async function expectSilence<K extends keyof ServerToClientEvents>(
  client: TestClient,
  event: K,
  windowMs = 300,
): Promise<void> {
  let received: unknown;
  const handler = ((payload: unknown) => {
    received = payload;
  }) as never;
  client.on(event, handler);
  await new Promise((resolve) => setTimeout(resolve, windowMs));
  client.off(event, handler);
  if (received !== undefined) {
    throw new Error(`ожидалась тишина, но пришло ${String(event)}: ${JSON.stringify(received)}`);
  }
}
