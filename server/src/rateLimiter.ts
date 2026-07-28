/**
 * Ограничение частоты событий на сокет (задача IP 4.7, ФТ-40, TDD §10.4).
 *
 * Два разных механизма, потому что это два разных вектора:
 *
 * - **Чат** — человек, который торопится. Наказание не должно быть
 *   катастрофическим: превышение отвечает `RATE_LIMITED`, сокет живёт, ввод не
 *   очищается. Отсюда token bucket с запасом (burst 5, refill 1/с): серия
 *   быстрых сообщений проходит, поток — нет.
 * - **Сигналинг** — 100 событий за 10 с это уже не человек, а сломанный или
 *   враждебный клиент. Отсюда жёсткий счётчик в окне и отключение сокета.
 *
 * Время инжектируется, иначе тесты пришлось бы писать на `setTimeout`,
 * а такие тесты либо медленные, либо нестабильные.
 */

export type Clock = () => number;

/**
 * Token bucket: `capacity` токенов, пополнение `refillPerSec` в секунду.
 * Дробное пополнение сохраняется, поэтому 1 токен/с честно накапливается и при
 * вызовах чаще, чем раз в секунду.
 */
export class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSec: number,
    private readonly now: Clock = Date.now,
  ) {
    this.tokens = capacity;
    this.lastRefill = now();
  }

  /** Пытается списать один токен. `false` = лимит превышен. */
  tryConsume(): boolean {
    this.refill();
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }

  /** Сколько токенов доступно сейчас (для диагностики и тестов). */
  available(): number {
    this.refill();
    return Math.floor(this.tokens);
  }

  private refill(): void {
    const now = this.now();
    const elapsedMs = now - this.lastRefill;
    if (elapsedMs <= 0) return;
    this.lastRefill = now;
    this.tokens = Math.min(this.capacity, this.tokens + (elapsedMs / 1000) * this.refillPerSec);
  }
}

/**
 * Счётчик событий в скользящем окне: не более `limit` событий за `windowMs`.
 *
 * Скользящее окно, а не фиксированное: с фиксированным окном клиент может
 * отправить 2 × limit событий на стыке двух окон и остаться незамеченным.
 */
export class SlidingWindowCounter {
  private readonly hits: number[] = [];

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: Clock = Date.now,
  ) {}

  /** Регистрирует событие. `false` = лимит превышен. */
  tryHit(): boolean {
    const now = this.now();
    const cutoff = now - this.windowMs;
    // Массив отсортирован по возрастанию: удаляем всё, что вышло из окна.
    while (this.hits.length > 0 && (this.hits[0] as number) <= cutoff) this.hits.shift();
    if (this.hits.length >= this.limit) return false;
    this.hits.push(now);
    return true;
  }

  /** Число событий в текущем окне. */
  count(): number {
    const cutoff = this.now() - this.windowMs;
    return this.hits.filter((t) => t > cutoff).length;
  }
}

export interface SocketLimits {
  /** Чат: превышение → `RATE_LIMITED`, сокет остаётся живым. */
  chat: TokenBucket;
  /** Сигналинг: превышение → отключение сокета. */
  signal: SlidingWindowCounter;
}

export interface SocketLimitsOptions {
  chatBurst: number;
  chatRefillPerSec: number;
  signalMax: number;
  signalWindowMs: number;
  now?: Clock;
}

/** Создаёт набор лимитеров для одного сокета. */
export function createSocketLimits(options: SocketLimitsOptions): SocketLimits {
  const { now = Date.now } = options;
  return {
    chat: new TokenBucket(options.chatBurst, options.chatRefillPerSec, now),
    signal: new SlidingWindowCounter(options.signalMax, options.signalWindowMs, now),
  };
}
