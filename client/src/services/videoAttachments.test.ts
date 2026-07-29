/**
 * Тесты привязки потоков к элементам (задача IP 12).
 *
 * Здесь закрываются три дефекта, которые раньше ловились только руками:
 * поток пришёл раньше элемента (группа 7), повторное присвоение того же потока,
 * блокировка автозапуска (группа 11). До выноса из `useRoomSession` эта логика
 * была непроверяемой — на неё приходилось ссылаться как на «ограничение».
 */
import { describe, expect, it, vi } from 'vitest';
import { VideoAttachments, type AttachableElement } from './videoAttachments';

/** Заглушка `<video>`: считает присвоения `srcObject` и вызовы `play()`. */
function fakeElement(playResult: 'ok' | 'blocked' | 'aborted' = 'ok') {
  const assignments: Array<MediaProvider | null> = [];
  const element = {
    _src: null as MediaProvider | null,
    get srcObject() {
      return this._src;
    },
    set srcObject(value: MediaProvider | null) {
      this._src = value;
      assignments.push(value);
    },
    play: vi.fn(() => {
      if (playResult === 'ok') return Promise.resolve();
      const error = new Error(playResult);
      error.name = playResult === 'blocked' ? 'NotAllowedError' : 'AbortError';
      return Promise.reject(error);
    }),
  };
  return { element: element as AttachableElement & typeof element, assignments };
}

/** Поток в том виде, в каком его хватает этому модулю. */
function fakeStream(id: string): MediaStream {
  return { id } as MediaStream;
}

describe('12 VideoAttachments: порядок событий (дефект группы 7)', () => {
  it('★ поток пришёл раньше элемента — присвоение при монтировании', () => {
    const attachments = new VideoAttachments(() => undefined);
    const { element, assignments } = fakeElement();
    const stream = fakeStream('s1');

    attachments.setStream('peer-1', stream);
    // Элемента ещё нет: React не отрендерил плитку.
    expect(assignments).toEqual([]);

    attachments.setElement('peer-1', element);
    expect(assignments).toEqual([stream]);
  });

  it('★ элемент смонтирован раньше потока — присвоение при появлении потока', () => {
    const attachments = new VideoAttachments(() => undefined);
    const { element, assignments } = fakeElement();
    const stream = fakeStream('s1');

    attachments.setElement('peer-1', element);
    expect(assignments).toEqual([]);

    attachments.setStream('peer-1', stream);
    expect(assignments).toEqual([stream]);
  });

  it('★ повторные вызовы не переприсваивают тот же поток (иначе мигает картинка)', () => {
    const attachments = new VideoAttachments(() => undefined);
    const { element, assignments } = fakeElement();
    const stream = fakeStream('s1');

    attachments.setStream('peer-1', stream);
    attachments.setElement('peer-1', element);
    // Ре-рендер плитки вызывает ref-колбэк заново.
    attachments.setElement('peer-1', element);
    attachments.setStream('peer-1', stream);

    expect(assignments).toEqual([stream]);
    expect(element.play).toHaveBeenCalledTimes(1);
  });

  it('новый поток того же пира присваивается', () => {
    const attachments = new VideoAttachments(() => undefined);
    const { element, assignments } = fakeElement();
    const first = fakeStream('s1');
    const second = fakeStream('s2');

    attachments.setElement('peer-1', element);
    attachments.setStream('peer-1', first);
    attachments.setStream('peer-1', second);

    expect(assignments).toEqual([first, second]);
  });

  it('потоки разных пиров не путаются', () => {
    const attachments = new VideoAttachments(() => undefined);
    const a = fakeElement();
    const b = fakeElement();

    attachments.setStream('peer-a', fakeStream('sa'));
    attachments.setStream('peer-b', fakeStream('sb'));
    attachments.setElement('peer-a', a.element);
    attachments.setElement('peer-b', b.element);

    expect(a.assignments).toEqual([fakeStream('sa')]);
    expect(b.assignments).toEqual([fakeStream('sb')]);
  });
});

describe('12 VideoAttachments: уход пира и конец сессии (риск R7)', () => {
  it('★ пир ушёл — элемент освобождён, поток забыт', () => {
    const attachments = new VideoAttachments(() => undefined);
    const { element, assignments } = fakeElement();

    attachments.setElement('peer-1', element);
    attachments.setStream('peer-1', fakeStream('s1'));
    attachments.removeStream('peer-1');

    expect(assignments.at(-1)).toBeNull();
    expect(attachments.size()).toBe(0);
  });

  it('★ после ухода пира старый поток не возвращается на плитку', () => {
    const attachments = new VideoAttachments(() => undefined);
    const { element, assignments } = fakeElement();
    const stream = fakeStream('s1');

    attachments.setElement('peer-1', element);
    attachments.setStream('peer-1', stream);
    attachments.removeStream('peer-1');
    // Плитка перерисовалась уже после ухода — присваивать нечего.
    attachments.setElement('peer-1', element);

    expect(assignments).toEqual([stream, null]);
  });

  it('размонтирование элемента забывает его, но поток сохраняется', () => {
    const attachments = new VideoAttachments(() => undefined);
    const { element, assignments } = fakeElement();
    const stream = fakeStream('s1');

    attachments.setStream('peer-1', stream);
    attachments.setElement('peer-1', element);
    attachments.setElement('peer-1', null);
    expect(attachments.size()).toBe(0);

    // Плитка вернулась (например, изменился порядок участников).
    const again = fakeElement();
    attachments.setElement('peer-1', again.element);
    expect(again.assignments).toEqual([stream]);
    expect(assignments).toEqual([stream]);
  });

  it('clear() освобождает всё', async () => {
    const attachments = new VideoAttachments(() => undefined);
    const { element } = fakeElement();

    attachments.setElement('peer-1', element);
    attachments.setStream('peer-1', fakeStream('s1'));
    attachments.clear();

    expect(attachments.size()).toBe(0);
    expect(await attachments.resumeAll()).toBe(true);
  });
});

describe('12 VideoAttachments: политика автозапуска (ФТ-37)', () => {
  it('★ NotAllowedError поднимает оверлей', async () => {
    const onAudioBlocked = vi.fn();
    const attachments = new VideoAttachments(onAudioBlocked);
    const { element } = fakeElement('blocked');

    attachments.setElement('peer-1', element);
    attachments.setStream('peer-1', fakeStream('s1'));
    await vi.waitFor(() => expect(onAudioBlocked).toHaveBeenCalledTimes(1));
  });

  it('★ AbortError оверлей НЕ поднимает: это штатное прерывание play()', async () => {
    const onAudioBlocked = vi.fn();
    const attachments = new VideoAttachments(onAudioBlocked);
    const { element } = fakeElement('aborted');

    attachments.setElement('peer-1', element);
    attachments.setStream('peer-1', fakeStream('s1'));
    // Даём промису play() разрешиться.
    await Promise.resolve();
    await Promise.resolve();

    expect(onAudioBlocked).not.toHaveBeenCalled();
  });

  it('★ успешный play() оверлей не поднимает', async () => {
    const onAudioBlocked = vi.fn();
    const attachments = new VideoAttachments(onAudioBlocked);
    const { element } = fakeElement('ok');

    attachments.setElement('peer-1', element);
    attachments.setStream('peer-1', fakeStream('s1'));
    await Promise.resolve();
    await Promise.resolve();

    expect(onAudioBlocked).not.toHaveBeenCalled();
  });

  it('★ resumeAll повторяет play() для ВСЕХ элементов', async () => {
    const attachments = new VideoAttachments(() => undefined);
    const a = fakeElement();
    const b = fakeElement();

    attachments.setElement('peer-a', a.element);
    attachments.setElement('peer-b', b.element);
    attachments.setStream('peer-a', fakeStream('sa'));
    attachments.setStream('peer-b', fakeStream('sb'));

    expect(await attachments.resumeAll()).toBe(true);
    // По одному вызову на привязку и по одному на повтор.
    expect(a.element.play).toHaveBeenCalledTimes(2);
    expect(b.element.play).toHaveBeenCalledTimes(2);
  });

  it('★ если хоть один элемент остался заблокирован — оверлей не убираем', async () => {
    const attachments = new VideoAttachments(() => undefined);
    const ok = fakeElement('ok');
    const blocked = fakeElement('blocked');

    attachments.setElement('peer-a', ok.element);
    attachments.setElement('peer-b', blocked.element);

    expect(await attachments.resumeAll()).toBe(false);
  });
});
