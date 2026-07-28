/**
 * Страж приватности (TDD §10.5, задача 1.4): текст сообщений чата и имена
 * участников не должны попадать в логи ни при каком вызове.
 */
import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { REDACTED_PATHS } from './logger.js';

/** Тот же logger, но пишущий в память, — сравниваем сериализованный вывод. */
function captureLogger(): { lines: string[]; log: pino.Logger } {
  const lines: string[] = [];
  const stream = {
    write(chunk: string) {
      lines.push(chunk);
    },
  };
  const log = pino(
    { level: 'debug', redact: { paths: [...REDACTED_PATHS], censor: '[redacted]' } },
    stream,
  );
  return { lines, log };
}

describe('logger redact', () => {
  it('не пишет текст сообщения чата', () => {
    const { lines, log } = captureLogger();
    log.info({ socketId: 'abc', text: 'секретное сообщение' }, 'chat:message');

    expect(lines.join('')).not.toContain('секретное сообщение');
    expect(lines.join('')).toContain('[redacted]');
  });

  it('не пишет текст во вложенном payload', () => {
    const { lines, log } = captureLogger();
    log.info({ payload: { text: 'тайна', to: 'peer-1' } }, 'chat');

    const out = lines.join('');
    expect(out).not.toContain('тайна');
    expect(out).toContain('peer-1');
  });

  it('не пишет отображаемое имя участника (персональные данные §10.5)', () => {
    const { lines, log } = captureLogger();
    log.info({ name: 'Анна Каренина', socketId: 'xyz' }, 'room:join');

    const out = lines.join('');
    expect(out).not.toContain('Анна');
    expect(out).toContain('xyz');
  });

  it('оставляет диагностические поля: id сокета, причину, err.name', () => {
    const { lines, log } = captureLogger();
    log.error({ err: new TypeError('boom'), socketId: 's-1', reason: 'transport close' }, 'fail');

    const out = lines.join('');
    expect(out).toContain('TypeError');
    expect(out).toContain('transport close');
    expect(out).toContain('s-1');
  });
});
