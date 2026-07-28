/**
 * Тесты graceful shutdown (задача IP 4.9, Q10, TDD §12.4).
 *
 * Проверяется главное: участник получает осмысленное системное сообщение
 * **до** того, как соединение закроется. Иначе рестарт выглядит как «сервер
 * недоступен», а auto-reconnect отключён требованием ФТ-31.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createShutdown } from './shutdown.js';
import { createHarness, waitFor, type Harness } from './socket/harness.test-utils.js';

let h: Harness;

afterEach(async () => {
  await h.close();
});

const silentLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
} as never;

describe('createShutdown', () => {
  it('★ рассылает системное сообщение о завершении работы и закрывает соединения', async () => {
    h = await createHarness();
    const { client } = await h.join('room-1', 'Аня');
    const onClosed = vi.fn();
    const shutdown = createShutdown({
      io: h.io,
      httpServer: h.httpServer,
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
    h = await createHarness();
    await h.join('room-1', 'Аня');
    const delay = vi.fn(() => Promise.resolve());
    const shutdown = createShutdown({
      io: h.io,
      httpServer: h.httpServer,
      graceMs: 2_000,
      logger: silentLogger,
      onClosed: () => undefined,
      delay,
    });

    await shutdown('SIGTERM');

    expect(delay).toHaveBeenCalledWith(2_000);
  });

  it('при выключенном notice сообщение не рассылается и паузы нет', async () => {
    h = await createHarness();
    await h.join('room-1', 'Аня');
    const delay = vi.fn(() => Promise.resolve());
    const emit = vi.spyOn(h.io, 'emit');
    const shutdown = createShutdown({
      io: h.io,
      httpServer: h.httpServer,
      notice: false,
      logger: silentLogger,
      onClosed: () => undefined,
      delay,
    });

    await shutdown('SIGTERM');

    expect(emit).not.toHaveBeenCalled();
    expect(delay).not.toHaveBeenCalled();
  });

  it('★ повторный сигнал игнорируется — двойной остановки не происходит', async () => {
    h = await createHarness();
    const onClosed = vi.fn();
    const shutdown = createShutdown({
      io: h.io,
      httpServer: h.httpServer,
      logger: silentLogger,
      onClosed,
      delay: () => Promise.resolve(),
    });

    await Promise.all([shutdown('SIGTERM'), shutdown('SIGINT')]);
    await shutdown('SIGTERM');

    expect(onClosed).toHaveBeenCalledTimes(1);
  });
});
