/**
 * Транспорт сигналинга (задача IP 1.4). Проверяется то, что реально способно
 * сломаться при неверной конфигурации: подключение по websocket, применение
 * лимитов из конфигурации и корректный путь.
 */
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import type { Server } from 'socket.io';
import { SOCKET_PATH } from '@video-chat/shared';
import { config } from '../config.js';
import { createSocketServer } from './createSocketServer.js';

let httpServer: HttpServer;
let io: Server;
let url: string;
const clients: ClientSocket[] = [];

beforeEach(async () => {
  httpServer = createServer();
  io = createSocketServer(httpServer);
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const { port } = httpServer.address() as AddressInfo;
  url = `http://127.0.0.1:${port}`;
});

afterEach(async () => {
  for (const c of clients.splice(0)) c.disconnect();
  await io.close();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

function connect(options: Parameters<typeof ioClient>[1] = {}): ClientSocket {
  const socket = ioClient(url, {
    path: SOCKET_PATH,
    transports: ['websocket'],
    reconnection: false,
    ...options,
  });
  clients.push(socket);
  return socket;
}

describe('createSocketServer', () => {
  it('принимает подключение по websocket', async () => {
    const socket = connect();
    const transport = await new Promise<string>((resolve, reject) => {
      socket.on('connect', () => resolve(socket.io.engine.transport.name));
      socket.on('connect_error', reject);
    });

    expect(socket.connected).toBe(true);
    expect(transport).toBe('websocket');
  });

  it('считает подключённые сокеты — источник счётчика для /health', async () => {
    const a = connect();
    const b = connect();
    await Promise.all(
      [a, b].map(
        (s) =>
          new Promise<void>((resolve, reject) => {
            s.on('connect', () => resolve());
            s.on('connect_error', reject);
          }),
      ),
    );

    expect(io.engine.clientsCount).toBe(2);
  });

  it('long-polling отключён: апгрейда с polling нет (TDD §9.3)', async () => {
    const socket = connect({ transports: ['polling'] });
    const error = await new Promise<Error>((resolve) => {
      socket.on('connect_error', resolve);
      socket.on('connect', () => resolve(new Error('подключение не должно было состояться')));
    });

    expect(socket.connected).toBe(false);
    expect(error).toBeInstanceOf(Error);
  });

  it('применяет лимиты и таймауты из конфигурации, а не дефолты библиотеки', () => {
    // `opts` помечен private в типах socket.io, но это единственный способ
    // убедиться, что значения из config действительно доехали до транспорта.
    const opts = (io as unknown as { opts: Record<string, unknown> }).opts;

    expect(opts.maxHttpBufferSize).toBe(config.maxHttpBufferSize);
    expect(opts.pingInterval).toBe(config.pingInterval);
    expect(opts.pingTimeout).toBe(config.pingTimeout);
    expect(opts.transports).toEqual(['websocket']);
    expect(opts.serveClient).toBe(false);
    expect(opts.path).toBe(SOCKET_PATH);
  });
});
