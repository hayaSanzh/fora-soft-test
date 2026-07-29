/**
 * Тесты автопрокрутки чата (задача IP 10.7, ФТ-23, US-8, TDD §7.5).
 *
 * Проверяется чистое условие «пользователь у нижней границы»: именно оно решает,
 * прокручивать ли историю. Безусловная прокрутка выдёргивала бы из чтения.
 */
import { describe, expect, it } from 'vitest';
import { isNearBottom } from './useAutoScroll';
import { config } from '../config';

describe('isNearBottom', () => {
  it('★ пользователь у самого низа — прокручиваем', () => {
    expect(isNearBottom({ scrollHeight: 1000, scrollTop: 700, clientHeight: 300 })).toBe(true);
  });

  it('★ пользователь пролистал вверх — НЕ прокручиваем (иначе выдернет из чтения)', () => {
    expect(isNearBottom({ scrollHeight: 1000, scrollTop: 100, clientHeight: 300 })).toBe(false);
  });

  it('порог берётся из конфигурации (§7.5, дефолт 50 px)', () => {
    expect(config.autoScrollThresholdPx).toBe(50);
    // 49 px до низа — всё ещё «внизу».
    expect(isNearBottom({ scrollHeight: 1000, scrollTop: 651, clientHeight: 300 })).toBe(true);
    // 51 px — уже нет.
    expect(isNearBottom({ scrollHeight: 1000, scrollTop: 649, clientHeight: 300 })).toBe(false);
  });

  it('порог можно переопределить', () => {
    const box = { scrollHeight: 1000, scrollTop: 600, clientHeight: 300 };

    expect(isNearBottom(box, 50)).toBe(false);
    expect(isNearBottom(box, 200)).toBe(true);
  });

  it('история короче контейнера — всегда «внизу»', () => {
    expect(isNearBottom({ scrollHeight: 200, scrollTop: 0, clientHeight: 300 })).toBe(true);
  });
});
