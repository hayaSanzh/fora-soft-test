/**
 * Привязка потоков пиров к элементам `<video>` (задача IP 12; вынесено из
 * `useRoomSession`, где эта логика была непроверяемой).
 *
 * Задача выглядит тривиальной — «присвоить `srcObject`» — но именно здесь
 * собрались три дефекта, найденных ручной приёмкой групп 7, 9 и 11:
 *
 * 1. **Поток может прийти раньше элемента, а элемент — раньше потока.** React
 *    рендерит плитку не в тот же момент, когда `ontrack` отдаёт поток. Одного
 *    места присвоения недостаточно: нужно присваивать и при появлении потока, и
 *    при монтировании элемента (дефект группы 7: self-view оставался чёрным до
 *    переключения камеры).
 * 2. **Присваивать один и тот же поток повторно нельзя** — картинка мигает
 *    (TDD §4.5, нюанс 5). Поэтому присвоение всегда под условием.
 * 3. **`play()` может быть отклонён политикой автозапуска** (ФТ-37). Отказ надо
 *    отличать от штатного `AbortError` и поднимать оверлей «Включить звук»
 *    (см. `lib/autoplay.ts`).
 *
 * ★ Self-view сюда не входит: у него другие правила — поток собирается из одной
 * дорожки заново при каждой смене камеры, элемент всегда `muted`, и запускать
 * `play()` для него не нужно (для заглушённого медиа автозапуск разрешён всегда).
 */
import { resumePlayback, tryPlay } from '../lib/autoplay';

/**
 * Минимальный контракт `<video>`: в тестах подставляется заглушка.
 *
 * Тип `srcObject` совпадает с настоящим `HTMLVideoElement` (`MediaProvider`), а
 * не сужен до `MediaStream`: сузив его, элемент перестаёт подходить под
 * интерфейс, и понадобилось бы приведение типов ровно в том месте, где ошибку
 * никто не заметит.
 */
export interface AttachableElement {
  srcObject: MediaProvider | null;
  play: () => Promise<void>;
}

export class VideoAttachments {
  private readonly elements = new Map<string, AttachableElement>();
  private readonly streams = new Map<string, MediaStream>();

  /**
   * @param onAudioBlocked вызывается, когда браузер отклонил `play()` по
   * политике автозапуска — UI поднимает оверлей «Включить звук».
   */
  constructor(private readonly onAudioBlocked: () => void) {}

  /** `ref`-колбэк плитки: элемент смонтирован (`element`) или размонтирован (`null`). */
  setElement(peerId: string, element: AttachableElement | null): void {
    if (element === null) {
      this.elements.delete(peerId);
      return;
    }
    this.elements.set(peerId, element);
    this.bind(peerId);
  }

  /** Поток пира готов (`ontrack`). */
  setStream(peerId: string, stream: MediaStream): void {
    this.streams.set(peerId, stream);
    this.bind(peerId);
  }

  /** Пир ушёл: освободить элемент и забыть поток. */
  removeStream(peerId: string): void {
    this.streams.delete(peerId);
    const element = this.elements.get(peerId);
    if (element) element.srcObject = null;
    this.elements.delete(peerId);
  }

  /**
   * Повторить воспроизведение для всех элементов. Возвращает `true`, если
   * блокировок больше нет.
   *
   * ★ Вызывать только из обработчика жеста пользователя: разрешение действует
   * ровно на время его обработки (см. `lib/autoplay.ts`).
   */
  resumeAll(): Promise<boolean> {
    return resumePlayback([...this.elements.values()]);
  }

  /** Конец сессии: ничего не держим. */
  clear(): void {
    this.elements.clear();
    this.streams.clear();
  }

  /** Для тестов и диагностики. */
  size(): number {
    return this.elements.size;
  }

  /** Присвоение и запуск — единственное место, где это происходит. */
  private bind(peerId: string): void {
    const element = this.elements.get(peerId);
    const stream = this.streams.get(peerId);
    if (!element || !stream) return;
    // ★ Повторное присвоение того же потока даёт мигание картинки.
    if (element.srcObject === stream) return;

    element.srcObject = stream;
    void tryPlay(element).then((blocked) => {
      if (blocked) this.onAudioBlocked();
    });
  }
}
