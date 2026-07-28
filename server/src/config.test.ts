/**
 * Приёмка решений Q5–Q11 (TDD §14.2), перенесённая из скриптовой проверки
 * группы 0 в постоянные тесты — как и было записано в отчёте приёмки.
 */
import { describe, expect, it } from 'vitest';
import { config, readServerConfig } from './config.js';

/** Дефолты проверяются на пустом окружении: тест не зависит от env машины разработчика. */
const defaults = readServerConfig({});

describe('server config: дефолты закрытых вопросов', () => {
  it('Q7: длина сообщения 500, антифлуд burst 5 + 1/с', () => {
    expect(defaults.maxMessageLen).toBe(500);
    expect(defaults.chatRateBurst).toBe(5);
    expect(defaults.chatRateRefillPerSec).toBe(1);
  });

  it('Q8: глубина истории чата 200', () => {
    expect(defaults.maxMessages).toBe(200);
  });

  it('Q10: системное сообщение при shutdown включено, пауза 2 с', () => {
    expect(defaults.shutdownNotice).toBe(true);
    expect(defaults.shutdownGraceMs).toBe(2_000);
  });

  it('Q11: /health только внутри сети, без дополнительных allowlist-префиксов', () => {
    expect(defaults.healthInternalOnly).toBe(true);
    expect(defaults.healthAllowlist).toEqual([]);
  });

  it('ФТ-38: имя ≤ 30 символов', () => {
    expect(defaults.maxNameLen).toBe(30);
  });
});

describe('server config: значения из TDD', () => {
  it('лимит участников 4 — следствие mesh (§9.2)', () => {
    expect(defaults.maxParticipants).toBe(4);
  });

  it('ping 10 000 / 5 000 → детект обрыва ~15 с (§4.1, R8)', () => {
    expect(defaults.pingInterval).toBe(10_000);
    expect(defaults.pingTimeout).toBe(5_000);
  });

  it('буфер socket.io 100 КБ (§4.3)', () => {
    expect(defaults.maxHttpBufferSize).toBe(100_000);
  });

  it('лимит сигналинга 100 событий / 10 с (§10.4)', () => {
    expect(defaults.signalRateMax).toBe(100);
    expect(defaults.signalRateWindowMs).toBe(10_000);
  });

  it('только websocket-транспорт (§9.3)', () => {
    expect(defaults.socketTransports).toEqual(['websocket']);
  });

  it('порт 3001 (§12.2)', () => {
    expect(defaults.port).toBe(3001);
  });
});

describe('server config: экспортируемый экземпляр', () => {
  it('собран из окружения процесса', () => {
    expect(config).toEqual(readServerConfig(process.env));
  });
});

describe('server config: переопределение через env (§12.5)', () => {
  it('числа, флаги и списки читаются из окружения', () => {
    const c = readServerConfig({
      MAX_MESSAGES: '50',
      CHAT_RATE_BURST: '9',
      MAX_MESSAGE_LEN: '200',
      SHUTDOWN_NOTICE: 'false',
      HEALTH_INTERNAL_ONLY: '0',
      PING_INTERVAL: '3000',
      CORS_ORIGIN: ' https://a.example , https://b.example ,, ',
    });

    expect(c.maxMessages).toBe(50);
    expect(c.chatRateBurst).toBe(9);
    expect(c.maxMessageLen).toBe(200);
    expect(c.shutdownNotice).toBe(false);
    expect(c.healthInternalOnly).toBe(false);
    expect(c.pingInterval).toBe(3_000);
    expect(c.corsOrigins).toEqual(['https://a.example', 'https://b.example']);
  });

  it('мусор в env не роняет процесс, а откатывается к дефолту', () => {
    const c = readServerConfig({
      MAX_PARTICIPANTS: 'abc',
      MAX_MESSAGES: '',
      SHUTDOWN_NOTICE: 'ага',
    });

    expect(c.maxParticipants).toBe(4);
    expect(c.maxMessages).toBe(200);
    expect(c.shutdownNotice).toBe(true);
  });

  it('дефолты не зависят от окружения процесса', () => {
    expect(readServerConfig({})).toEqual(readServerConfig({ UNRELATED: 'x' }));
  });

  it('HEALTH_ALLOWLIST добавляет разрешённые префиксы (Q11)', () => {
    expect(
      readServerConfig({ HEALTH_ALLOWLIST: '203.0.113., 198.51.100.1' }).healthAllowlist,
    ).toEqual(['203.0.113.', '198.51.100.1']);
  });
});
