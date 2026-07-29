/**
 * Баннер ошибки устройств (задача IP 11.4, ФТ-33, US-12, TDD §8.1, §8.3).
 *
 * ★ Главный инвариант: баннер **не блокирует** ничего. Отказ в доступе к камере
 * или микрофону не выкидывает из комнаты — пользователь остаётся в звонке с
 * выключенными устройствами, видит и слышит остальных и пишет в чат. Именно
 * поэтому это баннер внутри комнаты, а не экран: терминальна только ошибка
 * сокета (TDD §8.3).
 *
 * Баннер закрывается: сообщение прочитано, а место на экране нужно видео. Текст
 * не пропадает сам по таймеру — исчезающие сообщения об ошибках пользователь не
 * успевает прочитать.
 */
import type { MediaState } from '@video-chat/shared';
import { strings } from '../../strings';
import type { MediaErrorKind } from '../../state/roomReducer';

export interface MediaErrorBannerProps {
  kind: MediaErrorKind;
  /**
   * Фактическое состояние устройств. Нужно, чтобы не преувеличивать проблему:
   * разрешения выдаются по устройству, и при отказе только в камере микрофон
   * продолжает работать.
   */
  media?: MediaState | undefined;
  onDismiss: () => void;
}

/**
 * Текст по коду ошибки (TDD §8.1). Свой текст у каждого кода — не «что-то пошло
 * не так».
 *
 * ★ Для отказа в доступе и отсутствия устройства текст уточняется фактическим
 * состоянием: работающее устройство упоминать как неработающее нельзя. Если
 * состояние неизвестно (экран ожидания — устройства ещё не опрошены), берётся
 * общая формулировка.
 */
export function mediaErrorText(kind: MediaErrorKind, media?: MediaState): string {
  /** Ровно одно устройство работает — можно сказать точнее. */
  const onlyMicWorks = media?.audio === true && media.video === false;
  const onlyCameraWorks = media?.video === true && media.audio === false;

  switch (kind) {
    case 'NotAllowedError':
      if (onlyMicWorks) return strings.errors.mediaNotAllowedCamera;
      if (onlyCameraWorks) return strings.errors.mediaNotAllowedMic;
      return strings.errors.mediaNotAllowed;
    case 'NotFoundError':
      if (onlyMicWorks) return strings.errors.mediaNotFoundCamera;
      if (onlyCameraWorks) return strings.errors.mediaNotFoundMic;
      return strings.errors.mediaNotFound;
    case 'NotReadableError':
      return strings.errors.mediaNotReadable;
    case 'OverconstrainedError':
      return strings.errors.mediaOverconstrained;
    case 'DeviceLost':
      return strings.errors.mediaDeviceLost;
    case 'Unknown':
      return strings.errors.mediaUnknown;
  }
}

export function MediaErrorBanner({ kind, media, onDismiss }: MediaErrorBannerProps) {
  return (
    <div className="banner banner--error" role="status">
      <span className="banner__text">{mediaErrorText(kind, media)}</span>
      <button
        className="banner__dismiss"
        type="button"
        onClick={onDismiss}
        aria-label={strings.errors.dismiss}
      >
        {strings.errors.dismiss}
      </button>
    </div>
  );
}
