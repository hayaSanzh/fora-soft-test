/**
 * Тесты graceful shutdown (задача IP 4.9, Q10, TDD §12.4).
 *
 * Проверяется главное: участник получает осмысленное системное сообщение
 * **до** того, как соединение закроется (иначе рестарт выглядит как «сервер
 * недоступен», ведь auto-reconnect отключён требованием ФТ-31), и процесс
 * **действительно завершается**, а не остаётся висеть на keep-alive
 * соединениях браузера.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Server } from 'socket.io';
import { SOCKET_PATH } from '@video-chat/shared';
import { createShutdown } from './shutdown.js';
import { createHarness, waitFor, type Harness } from './socket/harness.test-utils.js';
import type { TypedServer } from './socket/types.js';

let h: Harness | null = null;

afterEach(async () => {
  await h?.close();
  h = null;
});

const silentLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
} as never;

describe('createShutdown: доставка сообщения', () => {
  it('★ рассылает системное сообщение о завершении работы и закрывает соединения', async () => {
    const harness = (h = await createHarness());
    const { client } = await harness.join('room-1', 'Аня');
    const onClosed = vi.fn();
    const shutdown = createShutdown({
      io: harness.io,
      httpServer: harness.httpServer,
      graceMs: 10,
      logger: silentLogger,
      generateId: () => 'shutdown-1',
      now: () => 1_769_000_000_000,
      onClosed,
      delay: () => Promise.resolve(),
    });

    const notice = waitFor(client, 'chat:message');
    const disconnected = new Promise<void>((resolve) => client.on('disconnect', () => resolve()));
    await shutdown('SIGTERM');

    expect(await notice).toEqual({
      type: 'system',
      id: 'shutdown-1',
      kind: 'shutdown',
      name: '',
      ts: 1_769_000_000_000,
    });
    await disconnected;
    expect(client.connected).toBe(false);
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it('пауза на доставку берётся из конфигурации (Q10)', async () => {
    const harness = (h = await createHarness());
    await harness.join('room-1', 'Аня');
    const delay = vi.fn(() => Promise.resolve());
    const shutdown = createShutdown({
      io: harness.io,
      httpServer: harness.httpServer,
      graceMs: 2_000,
      logger: silentLogger,
      onClosed: () => undefined,
      delay,
    });

    await shutdown('SIGTERM');

    expect(delay).toHaveBeenCalledWith(2_000);
  });

  it('при выключенном notice сообщение не рассылается и паузы нет', async () => {
    const harness = (h = await createHarness());
    await harness.join('room-1', 'Аня');
    const delay = vi.fn(() => Promise.resolve());
    const emit = vi.spyOn(harness.io, 'emit');
    const shutdown = createShutdown({
      io: harness.io,
      httpServer: harness.httpServer,
      notice: false,
      logger: silentLogger,
      onClosed: () => undefined,
      delay,
    });

    await shutdown('SIGTERM');

    expect(emit).not.toHaveBeenCalled();
    expect(delay).not.toHaveBeenCalled();
  });
});

describe('★ регрессия: процесс завершается быстро, а не висит на keep-alive', () => {
  /**
   * Сервер, отвечающий на HTTP-запросы, — как прод (там статику раздаёт express).
   * Стенд `createHarness` для этого не подходит: у него нет обработчика запросов,
   * ответ не приходит никогда, и keep-alive соединение просто не успевает
   * появиться (на этом мой первый вариант теста и завис).
   */
  async function startServerWithStatic(): Promise<{
    io: TypedServer;
    httpServer: http.Server;
    port: number;
  }> {
    const httpServer = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
    });
    const io = new Server(httpServer, {
      path: SOCKET_PATH,
      transports: ['websocket'],
    }) as unknown as TypedServer;
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    const { port } = httpServer.address() as AddressInfo;
    return { io, httpServer, port };
  }

  /** Открывает keep-alive соединение и оставляет его в пуле — как браузер. */
  async function openKeepAliveConnection(port: number): Promise<http.Agent> {
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    await new Promise<void>((resolve, reject) => {
      const request = http.get({ host: '127.0.0.1', port, path: '/', agent }, (response) => {
        response.resume();
        response.on('end', resolve);
      });
      request.on('error', reject);
    });
    return agent;
  }

  it('★ висящее keep-alive соединение не задерживает выход (было 81 с)', async () => {
    const server = await startServerWithStatic();
    const agent = await openKeepAliveConnection(server.port);

    const onClosed = vi.fn();
    const shutdown = createShutdown({
      io: server.io,
      httpServer: server.httpServer,
      logger: silentLogger,
      onClosed,
      delay: () => Promise.resolve(),
    });

    const startedAt = Date.now();
    await shutdown('SIGTERM');
    const elapsed = Date.now() - startedAt;

    expect(onClosed).toHaveBeenCalledTimes(1);
    // Без принудительного закрытия соединений здесь были бы десятки секунд:
    // `httpServer.close()` ждёт, пока keep-alive закроется сам.
    expect(elapsed).toBeLessThan(1_500);
    agent.destroy();
  });

  it('★ повторный сигнал завершает процесс немедленно, не запуская всё заново', async () => {
    const harness = (h = await createHarness());
    await harness.join('room-1', 'Аня');
    const emit = vi.spyOn(harness.io, 'emit');
    const onClosed = vi.fn();
    const shutdown = createShutdown({
      io: harness.io,
      httpServer: harness.httpServer,
      logger: silentLogger,
      onClosed,
      delay: () => Promise.resolve(),
    });

    await shutdown('SIGTERM');
    await shutdown('SIGINT');
    await shutdown('SIGINT');

    // Последовательность выполнена один раз: сообщение разослано единожды.
    expect(emit).toHaveBeenCalledTimes(1);
    // Но каждый повторный сигнал приводит к выходу — процесс не «залипает».
    expect(onClosed).toHaveBeenCalledTimes(3);
  });

  it('★ страховочный таймер: зависшее закрытие всё равно завершает процесс', async () => {
    const harness = (h = await createHarness());
    const onClosed = vi.fn();
    // `io.close()`, который никогда не разрешается — эмуляция зависшего закрытия.
    const stuckIo = {
      emit: vi.fn(),
      disconnectSockets: vi.fn(),
      close: () => new Promise<void>(() => undefined),
    } as unknown as TypedServer;
    const shutdown = createShutdown({
      io: stuckIo,
      httpServer: harness.httpServer,
      logger: silentLogger,
      forceExitAfterMs: 100,
      onClosed,
      delay: () => Promise.resolve(),
    });

    void shutdown('SIGTERM');
    await vi.waitFor(() => expect(onClosed).toHaveBeenCalledTimes(1), { timeout: 2_000 });
  });

  it('соединения закрываются принудительно: websocket и keep-alive HTTP', async () => {
    const harness = (h = await createHarness());
    await harness.join('room-1', 'Аня');
    const disconnectSockets = vi.spyOn(harness.io, 'disconnectSockets');
    const closeIdle = vi.spyOn(harness.httpServer, 'closeIdleConnections');
    const closeAll = vi.spyOn(harness.httpServer, 'closeAllConnections');
    const shutdown = createShutdown({
      io: harness.io,
      httpServer: harness.httpServer,
      logger: silentLogger,
      onClosed: () => undefined,
      delay: () => Promise.resolve(),
    });

    await shutdown('SIGTERM');

    expect(disconnectSockets).toHaveBeenCalledWith(true);
    expect(closeIdle).toHaveBeenCalled();
    expect(closeAll).toHaveBeenCalled();
  });
});
