/**
 * Тесты форматирования времени (задача IP 5.6, ФТ-22, TDD §9.3).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { formatTime, resetTimeFormatter } from './format';

afterEach(() => resetTimeFormatter());

/** epoch ms для 14:05 по UTC. Тесты запускаются с TZ=UTC (см. ниже). */
const TS = Date.UTC(2026, 0, 15, 14, 5, 0);

describe('formatTime', () => {
  it('★ возвращает ровно HH:MM без секунд и суффиксов', () => {
    const value = formatTime(TS);

    expect(value).toMatch(/^\d{2}:\d{2}$/);
  });

  it('минуты и часы дополняются нулём', () => {
    expect(formatTime(Date.UTC(2026, 0, 15, 7, 3, 0))).toMatch(/^\d{2}:\d{2}$/);
    expect(formatTime(Date.UTC(2026, 0, 15, 0, 0, 0))).toMatch(/^\d{2}:\d{2}$/);
  });

  it('★ время локальное: совпадает с часовым поясом окружения, а не с UTC', () => {
    // Результат сравнивается с поясом самого окружения — тест не должен зависеть
    // от TZ машины, на которой запущен (иначе он «зелёный только в CI»).
    const local = new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
      .format(new Date(TS))
      .replace(/[\u00A0\u202F\u2009]/gu, ' ')
      .trim();

    expect(formatTime(TS)).toBe(local);

    // И отдельно: разные пояса дают разное время, то есть пересчёт вообще есть.
    const inZone = (timeZone: string) =>
      new Intl.DateTimeFormat('ru-RU', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone,
      }).format(new Date(TS));

    expect(inZone('UTC')).not.toBe(inZone('Asia/Tokyo'));
  });

  it('★ форматтер кешируется: один инстанс на приложение (TDD §9.3)', () => {
    const created: string[] = [];
    const Original = Intl.DateTimeFormat;
    // Считаем создания форматтера.
    const spy = function (...args: unknown[]) {
      created.push('created');
      return new (Original as unknown as new (...a: unknown[]) => Intl.DateTimeFormat)(...args);
    } as unknown as typeof Intl.DateTimeFormat;
    Intl.DateTimeFormat = spy;

    try {
      resetTimeFormatter();
      for (let i = 0; i < 50; i++) formatTime(TS + i * 60_000);
    } finally {
      Intl.DateTimeFormat = Original;
    }

    expect(created).toHaveLength(1);
  });

  it('некорректный ts не роняет рендер истории', () => {
    expect(formatTime(Number.NaN)).toBe('');
    expect(formatTime(Number.POSITIVE_INFINITY)).toBe('');
  });
});
