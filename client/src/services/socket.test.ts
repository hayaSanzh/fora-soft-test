/**
 * Тесты фабрики сокета (задача IP 6.1, ФТ-31, TDD §4.1).
 *
 * Проверяются именно те опции, ошибка в которых не видна глазами, но ломает
 * требования: включённый auto-reconnect оставил бы на сервере фантомного
 * участника, а long-polling добавил бы лишний round-trip на старте.
 */
import { describe, expect, it } from 'vitest';
import { SOCKET_PATH } from '@video-chat/shared';
import { config } from '../config';
import { createSocket } from './socket';

/** Опции соединения лежат в `io.opts`; тип не публичный, поэтому читаем через приведение. */
function optsOf(socket: ReturnType<typeof createSocket>): Record<string, unknown> {
  return (socket.io as unknown as { opts: Record<string, unknown> }).opts;
}

describe('createSocket', () => {
  it('★ auto-reconnect выключен (ФТ-31: возврат только повторным входом)', () => {
    const socket = createSocket({ url: 'http://127.0.0.1:1' });

    expect(optsOf(socket).reconnection).toBe(false);
    socket.disconnect();
  });

  it('★ не подключается сам: слот занимается только после ввода имени', () => {
    const socket = createSocket({ url: 'http://127.0.0.1:1' });

    expect(socket.connected).toBe(false);
    expect(optsOf(socket).autoConnect).toBe(false);
    socket.disconnect();
  });

  it('только websocket, без апгрейда с long-polling (TDD §9.3)', () => {
    const socket = createSocket({ url: 'http://127.0.0.1:1' });

    expect(optsOf(socket).transports).toEqual(['websocket']);
    socket.disconnect();
  });

  it('таймаут и путь берутся из конфигурации', () => {
    const socket = createSocket({ url: 'http://127.0.0.1:1' });

    expect(optsOf(socket).timeout).toBe(config.socketTimeoutMs);
    expect(optsOf(socket).path).toBe(SOCKET_PATH);
    socket.disconnect();
  });

  it('таймаут можно переопределить (нужно тестам и диагностике)', () => {
    const socket = createSocket({ url: 'http://127.0.0.1:1', timeoutMs: 250 });

    expect(optsOf(socket).timeout).toBe(250);
    socket.disconnect();
  });
});
