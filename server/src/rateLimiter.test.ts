/**
 * Тесты лимитеров (задача IP 4.7, ФТ-40, TDD §10.4).
 * Время подменяется, поэтому тесты быстрые и детерминированные.
 */
import { describe, expect, it } from 'vitest';
import { createSocketLimits, SlidingWindowCounter, TokenBucket } from './rateLimiter.js';

describe('TokenBucket (чат)', () => {
  it('пропускает burst и отклоняет следующее', () => {
    const now = 0;
    const bucket = new TokenBucket(5, 1, () => now);

    expect(Array.from({ length: 5 }, () => bucket.tryConsume())).toEqual([
      true,
      true,
      true,
      true,
      true,
    ]);
    expect(bucket.tryConsume()).toBe(false);
  });

  it('пополняется со временем и не превышает ёмкость', () => {
    let now = 0;
    const bucket = new TokenBucket(5, 1, () => now);
    for (let i = 0; i < 5; i++) bucket.tryConsume();

    now = 1_000; // +1 токен
    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(false);

    now = 100_000; // прошло много времени — но ёмкость 5
    expect(bucket.available()).toBe(5);
  });

  it('дробное пополнение накапливается, а не теряется', () => {
    let now = 0;
    const bucket = new TokenBucket(1, 1, () => now);
    expect(bucket.tryConsume()).toBe(true);

    // Пять проверок по 200 мс: токен должен появиться ровно к 1000 мс.
    for (const t of [200, 400, 600, 800]) {
      now = t;
      expect(bucket.tryConsume()).toBe(false);
    }
    now = 1_000;
    expect(bucket.tryConsume()).toBe(true);
  });

  it('при refill 0 токены не восстанавливаются', () => {
    let now = 0;
    const bucket = new TokenBucket(2, 0, () => now);
    bucket.tryConsume();
    bucket.tryConsume();

    now = 60_000;
    expect(bucket.tryConsume()).toBe(false);
  });
});

describe('SlidingWindowCounter (сигналинг)', () => {
  it('пропускает limit событий в окне и блокирует следующее', () => {
    const now = 0;
    const counter = new SlidingWindowCounter(3, 1_000, () => now);

    expect([counter.tryHit(), counter.tryHit(), counter.tryHit()]).toEqual([true, true, true]);
    expect(counter.tryHit()).toBe(false);
    expect(counter.count()).toBe(3);
  });

  it('★ окно скользящее: 2 × limit на стыке окон не проходят', () => {
    let now = 0;
    const counter = new SlidingWindowCounter(3, 1_000, () => now);

    now = 900;
    expect([counter.tryHit(), counter.tryHit(), counter.tryHit()]).toEqual([true, true, true]);
    now = 1_100; // фиксированное окно уже «сбросилось» бы, скользящее — нет
    expect(counter.tryHit()).toBe(false);
  });

  it('после выхода событий из окна счётчик снова пропускает', () => {
    let now = 0;
    const counter = new SlidingWindowCounter(2, 1_000, () => now);
    counter.tryHit();
    counter.tryHit();

    now = 1_500;
    expect(counter.tryHit()).toBe(true);
    expect(counter.count()).toBe(1);
  });
});

describe('createSocketLimits', () => {
  it('собирает независимые лимитеры чата и сигналинга из конфигурации', () => {
    const now = 0;
    const limits = createSocketLimits({
      chatBurst: 2,
      chatRefillPerSec: 1,
      signalMax: 3,
      signalWindowMs: 1_000,
      now: () => now,
    });

    limits.chat.tryConsume();
    limits.chat.tryConsume();
    expect(limits.chat.tryConsume()).toBe(false);
    // Исчерпанный чат не влияет на сигналинг.
    expect(limits.signal.tryHit()).toBe(true);
  });
});
