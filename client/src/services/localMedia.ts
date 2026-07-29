/**
 * Локальные медиадорожки и тумблеры (задача IP 7, TDD §4.4).
 *
 * ★ Микрофон и камера ведут себя **принципиально по-разному**, и это следует из
 * требований, а не из удобства реализации:
 *
 * | | Микрофон (ФТ-15, ФТ-16) | Камера (ФТ-17, ФТ-19) |
 * |---|---|---|
 * | требование | «аудио перестаёт передаваться» | «камера физически перестаёт использоваться, лампочка гаснет» |
 * | выключение | `track.enabled = false` — дорожка жива, отдаёт тишину | `replaceTrack(null)` + `track.stop()` — дорожка уничтожена |
 * | включение | `track.enabled = true`, ~0 мс | повторный `getUserMedia`, 150–600 мс |
 * | ренегоциация | не нужна | **тоже не нужна** (см. ниже) |
 *
 * **Почему `replaceTrack(null)`, а не `pc.removeTrack()`** (риск R4): `removeTrack`
 * меняет направление трансивера → `negotiationneeded` → полный цикл offer/answer
 * на каждом из трёх соединений при каждом клике по кнопке камеры. Это 6 SDP-обменов
 * на комнату за одно нажатие, риск glare и заметный провал видео у остальных.
 * `replaceTrack(null)` оставляет m-строку и трансивер на месте.
 *
 * Модуль не знает ни про React, ни про `PeerManager`: дорожки уходят наружу
 * колбэками `onAudioTrack` / `onVideoTrack`, которые в группах 8–9 подключаются
 * к `replaceTrack` на всех peer-соединениях. Благодаря этому все ветки —
 * включая отказ в доступе и потерю устройства — проверяются тестами без браузера.
 */
import type { MediaState } from '@video-chat/shared';
import { config } from '../config';
import type { MediaErrorKind } from '../state/roomReducer';

export interface LocalMediaCallbacks {
  /** Новая аудиодорожка или её отсутствие. Подключается к senders в группе 8. */
  onAudioTrack?: (track: MediaStreamTrack | null) => void;
  /** Новая видеодорожка или `null` при выключении камеры. */
  onVideoTrack?: (track: MediaStreamTrack | null) => void;
  /** Состояние устройств изменилось: обновить UI и разослать `media:state` (ФТ-15…18). */
  onStateChange?: (state: MediaState) => void;
  /** Ошибка доступа к устройствам. `null` — ошибок больше нет. */
  onError?: (kind: MediaErrorKind | null) => void;
}

export interface LocalMediaOptions extends LocalMediaCallbacks {
  /** Источник устройств; в тестах подменяется фейком. */
  mediaDevices?: MediaDevices;
}

/**
 * Приводит ошибку `getUserMedia` к коду для UI (TDD §8.1).
 *
 * ★ Имя читается у любого объекта, а не только у `instanceof Error`. Браузер
 * бросает `DOMException`, и хотя в текущих движках он наследует `Error`, это
 * деталь реализации, а не требование WebIDL. Опора на `instanceof` дала бы
 * `String(error)` вида `'NotAllowedError: Permission denied'`, который не
 * совпадает ни с одной ветвью — и самая частая ошибка, отказ в доступе, молча
 * превратилась бы в безликое «Не удалось получить доступ» вместо подсказки
 * «разрешите доступ в настройках браузера» (ФТ-33).
 */
export function toMediaErrorKind(error: unknown): MediaErrorKind {
  const name =
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { name?: unknown }).name === 'string'
      ? (error as { name: string }).name
      : String(error);
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError': // старое имя в некоторых сборках
      return 'NotAllowedError';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'NotFoundError';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'NotReadableError';
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return 'OverconstrainedError';
    default:
      return 'Unknown';
  }
}

export class LocalMedia {
  private readonly devices: MediaDevices;
  private readonly callbacks: LocalMediaCallbacks;

  private audioTrack: MediaStreamTrack | null = null;
  private videoTrack: MediaStreamTrack | null = null;
  /** Тумблеры: что пользователь хочет. Может расходиться с наличием дорожки. */
  private micOn = false;
  private cameraOn = false;
  private disposed = false;
  private readonly onDeviceChange: () => void;

  constructor(options: LocalMediaOptions = {}) {
    this.devices = options.mediaDevices ?? navigator.mediaDevices;
    this.callbacks = options;

    // ФТ-20: появление или исчезновение устройства. Само по себе это не меняет
    // состояние — исчезновение живой дорожки придёт событием `ended`, — но UI
    // должен получить шанс разблокировать тумблер, если устройство появилось.
    this.onDeviceChange = () => this.emitState();
    this.devices.addEventListener?.('devicechange', this.onDeviceChange);
  }

  get state(): MediaState {
    // Состояние = «пользователь хочет» И «дорожка реально есть и жива».
    return {
      audio: this.micOn && this.audioTrack !== null && this.audioTrack.enabled,
      video: this.cameraOn && this.videoTrack !== null,
    };
  }

  getAudioTrack(): MediaStreamTrack | null {
    return this.audioTrack;
  }

  getVideoTrack(): MediaStreamTrack | null {
    return this.videoTrack;
  }

  /**
   * Первичное получение устройств (задачи 7.1, 7.2; ФТ-13, ФТ-14, US-6).
   *
   * ★ **Два независимых вызова `getUserMedia`**, каждый в своём `try/catch`.
   * Один совмещённый вызов `{audio: true, video: true}` падает целиком, если
   * отсутствует **любое** из устройств, — и пользователь без камеры не смог бы
   * войти даже как слушатель, нарушая ФТ-14.
   *
   * Функция **никогда не бросает**: отказ в доступе не терминален (ФТ-33).
   */
  async acquire(): Promise<MediaState> {
    let firstError: MediaErrorKind | null = null;

    // Микрофон: по умолчанию включён (ФТ-13).
    try {
      const stream = await this.devices.getUserMedia({ audio: true });
      this.setAudioTrack(stream.getAudioTracks()[0] ?? null);
      this.micOn = this.audioTrack !== null;
    } catch (error) {
      firstError = toMediaErrorKind(error);
      this.micOn = false;
    }

    // Камера — отдельно, чтобы отказ микрофона её не отменил.
    try {
      const track = await this.requestVideoTrack();
      this.setVideoTrack(track);
      this.cameraOn = true;
    } catch (error) {
      firstError ??= toMediaErrorKind(error);
      this.cameraOn = false;
    }

    if (this.disposed) {
      // Пользователь успел уйти, пока браузер спрашивал разрешение.
      this.teardown();
      return { audio: false, video: false };
    }

    this.callbacks.onError?.(firstError);
    this.emitState();
    return this.state;
  }

  /**
   * Тумблер микрофона (задача 7.3, ФТ-15, ФТ-16, US-7).
   *
   * Дорожка **остаётся живой** и отдаёт тишину: `enabled = false` не требует
   * ренегоциации и переключается мгновенно. Останавливать её нельзя — иначе
   * включение микрофона стоило бы нового `getUserMedia` и SDP-обмена.
   */
  async setMicEnabled(on: boolean): Promise<MediaState> {
    if (on && this.audioTrack === null) {
      // Устройства не было при входе (или его отключали) — пробуем снова:
      // пользователь мог разрешить доступ или подключить микрофон.
      try {
        const stream = await this.devices.getUserMedia({ audio: true });
        this.setAudioTrack(stream.getAudioTracks()[0] ?? null);
        this.callbacks.onError?.(null);
      } catch (error) {
        this.callbacks.onError?.(toMediaErrorKind(error));
        this.micOn = false;
        this.emitState();
        return this.state;
      }
    }

    this.micOn = on;
    if (this.audioTrack) this.audioTrack.enabled = on;
    this.emitState();
    return this.state;
  }

  /**
   * Тумблер камеры (задача 7.4, ФТ-17, ФТ-19, US-7).
   *
   * Выключение: сначала снимаем дорожку с senders (`onVideoTrack(null)`), затем
   * `track.stop()` — именно `stop()` гасит аппаратный индикатор камеры, чего
   * прямо требует ФТ-19. Включение: новый `getUserMedia` и подстановка дорожки.
   */
  async setCameraEnabled(on: boolean): Promise<MediaState> {
    if (!on) {
      this.cameraOn = false;
      // Порядок важен: сначала перестаём отправлять, потом освобождаем железо.
      this.callbacks.onVideoTrack?.(null);
      this.stopVideoTrack();
      this.emitState();
      return this.state;
    }

    try {
      const track = await this.requestVideoTrack();
      if (this.disposed) {
        track.stop();
        return this.state;
      }
      this.setVideoTrack(track);
      this.cameraOn = true;
      this.callbacks.onError?.(null);
    } catch (error) {
      this.cameraOn = false;
      this.callbacks.onError?.(toMediaErrorKind(error));
    }
    this.emitState();
    return this.state;
  }

  /**
   * Остановка **всех** дорожек (задача 7.6, ФТ-27, риск R7).
   *
   * Пропуск этого шага — самая частая причина «камера продолжает гореть после
   * выхода». Метод идемпотентен: выход и размонтирование могут случиться подряд.
   */
  teardown(): void {
    this.disposed = true;
    this.devices.removeEventListener?.('devicechange', this.onDeviceChange);

    this.callbacks.onVideoTrack?.(null);
    this.callbacks.onAudioTrack?.(null);

    this.stopVideoTrack();
    if (this.audioTrack) {
      this.audioTrack.onended = null;
      this.audioTrack.stop();
      this.audioTrack = null;
    }
    this.micOn = false;
    this.cameraOn = false;
  }

  // ── Внутреннее ─────────────────────────────────────────────────────────────

  /**
   * Запрос видеодорожки с ретраем на ослабленных constraints (задача 7.2).
   *
   * `OverconstrainedError` означает, что камера не умеет запрошенное качество —
   * на дешёвых веб-камерах это штатная ситуация. Отказывать пользователю в
   * видео из-за разрешения неправильно: повторяем запрос без ограничений.
   */
  private async requestVideoTrack(): Promise<MediaStreamTrack> {
    try {
      const stream = await this.devices.getUserMedia({ video: config.videoConstraints });
      const track = stream.getVideoTracks()[0];
      if (!track) throw new Error('NotFoundError');
      return track;
    } catch (error) {
      if (toMediaErrorKind(error) !== 'OverconstrainedError') throw error;

      const stream = await this.devices.getUserMedia({ video: true });
      const track = stream.getVideoTracks()[0];
      if (!track) throw new Error('NotFoundError');
      return track;
    }
  }

  private setAudioTrack(track: MediaStreamTrack | null): void {
    this.audioTrack = track;
    if (!track) return;
    track.onended = () => this.handleTrackEnded('audio');
    this.callbacks.onAudioTrack?.(track);
  }

  private setVideoTrack(track: MediaStreamTrack): void {
    this.videoTrack = track;
    track.onended = () => this.handleTrackEnded('video');
    this.callbacks.onVideoTrack?.(track);
  }

  private stopVideoTrack(): void {
    if (!this.videoTrack) return;
    this.videoTrack.onended = null;
    this.videoTrack.stop();
    this.videoTrack = null;
  }

  /**
   * Устройство исчезло во время звонка (задача 7.5, ФТ-20).
   *
   * Тумблер уходит в off, состояние рассылается остальным (иначе у них
   * останется «живая» плитка без картинки), пользователь получает баннер.
   * Восстановление — выбором устройства в настройках ОС и повторным включением.
   */
  private handleTrackEnded(kind: 'audio' | 'video'): void {
    if (this.disposed) return;

    if (kind === 'audio') {
      this.audioTrack = null;
      this.micOn = false;
      this.callbacks.onAudioTrack?.(null);
    } else {
      this.videoTrack = null;
      this.cameraOn = false;
      this.callbacks.onVideoTrack?.(null);
    }

    this.callbacks.onError?.('DeviceLost');
    this.emitState();
  }

  private emitState(): void {
    if (this.disposed) return;
    this.callbacks.onStateChange?.(this.state);
  }
}
