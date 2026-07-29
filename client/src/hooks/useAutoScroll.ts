/**
 * Автопрокрутка чата (задача IP 10.7, ФТ-23, US-8, TDD §7.5).
 *
 * ★ Прокрутка к новому сообщению выполняется **только если пользователь уже
 * у нижней границы**. Безусловная прокрутка выдёргивала бы из чтения истории:
 * человек листает вверх, приходит сообщение — и его отбрасывает вниз.
 */
import { useEffect, useRef } from 'react';
import { config } from '../config';

export interface ScrollBox {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

/**
 * У нижней границы ли пользователь.
 *
 * Порог нужен из-за дробных значений при масштабировании и из-за того, что
 * «почти внизу» пользователь воспринимает как «внизу» (TDD §7.5).
 */
export function isNearBottom(
  box: ScrollBox,
  threshold: number = config.autoScrollThresholdPx,
): boolean {
  return box.scrollHeight - box.scrollTop - box.clientHeight < threshold;
}

/**
 * Прокручивает контейнер к низу при изменении `dependency` (числа сообщений),
 * но только если пользователь и так был внизу.
 *
 * Возвращает `ref` для контейнера истории.
 */
export function useAutoScroll<T extends HTMLElement>(dependency: number) {
  const ref = useRef<T | null>(null);
  /** Было ли «внизу» ДО прихода сообщения: после вставки метрики уже другие. */
  const wasNearBottom = useRef(true);

  // Слушаем прокрутку, чтобы знать положение пользователя на момент вставки.
  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const onScroll = () => {
      wasNearBottom.current = isNearBottom(element);
    };
    element.addEventListener('scroll', onScroll, { passive: true });
    return () => element.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const element = ref.current;
    if (!element || !wasNearBottom.current) return;
    element.scrollTop = element.scrollHeight;
  }, [dependency]);

  return ref;
}
