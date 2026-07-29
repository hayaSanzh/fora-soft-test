/**
 * Тесты политики автозапуска (задача IP 11.5, ФТ-37, риск R6).
 *
 * Здесь проверяются два свойства, которые ломаются молча и в противоположные
 * стороны: оверлей «Включить звук» не должен выскакивать на штатных отказах
 * `play()`, и обязан появляться на настоящей блокировке. Плюс требование к
 * порядку вызовов: разрешение действует только на время жеста пользователя.
 */
import { describe, expect, it, vi } from 'vitest';
import { isAutoplayBlocked, resumePlayback, tryPlay } from './autoplay';

/** Ошибка в том виде, в каком её отдаёт браузер: важно только поле `name`. */
function domError(name: string): Error {
  const error = new Error(name);
  error.name = name;
  return error;
}

describe('11.5 распознавание блокировки автозапуска', () => {
  it('★ NotAllowedError — это блокировка политикой', () => {
    expect(isAutoplayBlocked(domError('NotAllowedError'))).toBe(true);
  });

  it('★ AbortError блокировкой НЕ считается: play() прерван новым srcObject', () => {
    // Иначе оверлей «Включить звук» появлялся бы при каждой смене потока,
    // хотя звук работает.
    expect(isAutoplayBlocked(domError('AbortError'))).toBe(false);
  });

  it('прочие отказы блокировкой не считаются', () => {
    expect(isAutoplayBlocked(domError('NotSupportedError'))).toBe(false);
    expect(isAutoplayBlocked('NotAllowedError')).toBe(false);
    expect(isAutoplayBlocked(null)).toBe(false);
    expect(isAutoplayBlocked(undefined)).toBe(false);
  });
});

describe('11.5 tryPlay', () => {
  it('★ успешный запуск: блокировки нет', async () => {
    expect(await tryPlay({ play: () => Promise.resolve() })).toBe(false);
  });

  it('★ NotAllowedError: нужен жест пользователя', async () => {
    expect(await tryPlay({ play: () => Promise.reject(domError('NotAllowedError')) })).toBe(true);
  });

  it('★ не бросает исключений — иначе сорвётся привязка потока к плитке', async () => {
    await expect(tryPlay({ play: () => Promise.reject(domError('AbortError')) })).resolves.toBe(
      false,
    );
  });
});

describe('11.5 ★ resumePlayback: жест пользователя', () => {
  /**
   * Модель разрешения браузера: `play()` проходит, только пока «жест активен».
   * Жест закрывается в конце текущей микрозадачи — ровно поэтому нельзя
   * ожидать элементы по очереди.
   */
  function gestureModel() {
    let active = true;
    // Закрываем «окно жеста» после текущего синхронного блока.
    void Promise.resolve().then(() => {
      active = false;
    });
    const make = () => ({
      play: vi.fn(() => (active ? Promise.resolve() : Promise.reject(domError('NotAllowedError')))),
    });
    return { make };
  }

  it('★ play() вызывается для всех элементов внутри жеста, а не по очереди', async () => {
    const { make } = gestureModel();
    const elements = [make(), make(), make()];

    expect(await resumePlayback(elements)).toBe(true);
    for (const element of elements) expect(element.play).toHaveBeenCalledTimes(1);
  });

  it('★ последовательное ожидание потеряло бы жест — контрпример к наивной реализации', async () => {
    const { make } = gestureModel();
    const elements = [make(), make(), make()];

    // Наивная реализация: await внутри цикла.
    const blocked: boolean[] = [];
    for (const element of elements) blocked.push(await tryPlay(element));

    // Первый успел, остальные — уже нет.
    expect(blocked).toEqual([false, true, true]);
  });

  it('★ если хоть один остался заблокирован — оверлей не убираем', async () => {
    const ok = { play: () => Promise.resolve() };
    const bad = { play: () => Promise.reject(domError('NotAllowedError')) };

    expect(await resumePlayback([ok, bad])).toBe(false);
  });

  it('пустой список: убирать оверлей можно (в комнате никого)', async () => {
    expect(await resumePlayback([])).toBe(true);
  });

  it('штатный AbortError не мешает убрать оверлей', async () => {
    const aborted = { play: () => Promise.reject(domError('AbortError')) };

    expect(await resumePlayback([aborted])).toBe(true);
  });
});
