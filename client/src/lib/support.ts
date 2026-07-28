/**
 * Детектор поддержки WebRTC (задача IP 5.1, ФТ-36, US-13, TDD §8.1).
 *
 * Проверка выполняется **до монтирования App**: если браузер не умеет WebRTC,
 * пользователь должен увидеть внятное сообщение, а не белый экран после падения
 * первого же обращения к `getUserMedia`.
 *
 * Отдельно проверяется secure context. Это не придирка: `getUserMedia` и
 * `RTCPeerConnection` доступны только по HTTPS (исключение — `localhost`), и на
 * `http://192.168.x.x` приложение выглядит «сломанным без причины» — самая
 * частая ошибка на этапе LAN-проверки (TDD §12.1).
 */

/** Причина отказа. `null` в результате означает «поддержка есть». */
export type UnsupportedReason =
  /** Нет `RTCPeerConnection` или `getUserMedia` — браузер слишком старый (ФТ-36). */
  | 'WEBRTC_UNSUPPORTED'
  /** API есть, но страница открыта без HTTPS — устройства будут недоступны. */
  | 'INSECURE_CONTEXT';

export interface SupportResult {
  ok: boolean;
  reason: UnsupportedReason | null;
  details: {
    rtcPeerConnection: boolean;
    getUserMedia: boolean;
    secureContext: boolean;
  };
}

/** Минимальный контракт окружения — позволяет тестировать детектор без браузера. */
export interface SupportEnvironment {
  RTCPeerConnection?: unknown;
  isSecureContext?: boolean;
  navigator?: {
    mediaDevices?: { getUserMedia?: unknown };
  };
}

/**
 * Проверяет окружение. По умолчанию смотрит на реальный `window`.
 *
 * ★ Порядок проверок: **secure context проверяется первым.** Это не
 * формальность, а следствие поведения браузеров: на небезопасном origin Chrome
 * вообще не отдаёт `navigator.mediaDevices`, поэтому проверка «нет
 * getUserMedia» сработала бы раньше и пользователь на `http://192.168.x.x`
 * получил бы сообщение «браузер не поддерживает WebRTC» — неверное по сути и
 * бесполезное: браузер поддерживает, дело в схеме URL.
 */
export function detectWebRtcSupport(env?: SupportEnvironment): SupportResult {
  const scope: SupportEnvironment = env ?? (typeof window !== 'undefined' ? window : {});

  const rtcPeerConnection = typeof scope.RTCPeerConnection === 'function';
  const getUserMedia = typeof scope.navigator?.mediaDevices?.getUserMedia === 'function';
  // `isSecureContext` отсутствует только в очень старых браузерах; там сработает
  // проверка API ниже, поэтому неизвестное значение трактуем как безопасное.
  const secureContext = scope.isSecureContext !== false;

  const details = { rtcPeerConnection, getUserMedia, secureContext };

  if (!secureContext) {
    return { ok: false, reason: 'INSECURE_CONTEXT', details };
  }
  if (!rtcPeerConnection || !getUserMedia) {
    return { ok: false, reason: 'WEBRTC_UNSUPPORTED', details };
  }
  return { ok: true, reason: null, details };
}
