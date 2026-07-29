/**
 * Плитка участника (задачи IP 10.1, 10.2, 10.9).
 *
 * ★ Ключевое правило (TDD §4.7, риск R5): элемент `<video>` **смонтирован
 * всегда**, даже когда камера выключена. Условный рендеринг `<video>` убивает
 * аудио пира — самая частая регрессия в таких проектах. Поэтому заглушка не
 * заменяет видео, а рисуется **оверлеем поверх** него.
 *
 * ★ Второе правило (ФТ-16, ФТ-18): состояние устройств берётся из `media:state`,
 * а не из WebRTC-событий. Причина практическая: `replaceTrack(null)` не удаляет
 * дорожку у получателя — она переходит в `muted`, и `<video>` замирает на
 * последнем кадре. Без оверлея собеседник видел бы «зависшее лицо» вместо
 * заглушки — именно этот дефект нашла ручная приёмка группы 9.
 *
 * Компонент появился в группе 9 (а не 10) ровно из-за этого дефекта.
 *
 * ★ Третье правило (задача 10.9): плитка обёрнута в `React.memo` со сравнением
 * по `participantId`, `media` и `connectionState`. Без этого переписка в чате
 * перерисовывала бы всю видеосетку — на каждое сообщение (TDD §9.3).
 */
import { memo } from 'react';
import type { Participant } from '@video-chat/shared';
import { strings } from '../strings';

export interface VideoTileProps {
  participant: Participant;
  isSelf: boolean;
  /** Состояние соединения для индикации (Q9, ФТ-34); у себя — не показывается. */
  connectionState?: RTCPeerConnectionState | undefined;
  /** `ref`-колбэк: привязка `<video>` к потоку (self-view или поток пира). */
  attachVideo: (element: HTMLVideoElement | null) => void;
}

/**
 * Состояние соединения для индикации (задача 11.6, ФТ-34, Q9, риск R1).
 *
 * ★ `undefined` считается «соединяемся», а не «всё хорошо»: состояние приходит
 * из `onconnectionstatechange`, и до первого события его просто нет. Иначе в
 * самый важный момент — сразу после входа участника — плитка была бы чёрной без
 * объяснений.
 *
 * ★ `failed` показывается отдельным текстом: без TURN пара за симметричным NAT
 * не соединится (риск R1), и это должно читаться как «связь не установилась», а
 * не как необъяснимый чёрный прямоугольник.
 */
function connectionStatus(
  state: RTCPeerConnectionState | undefined,
): { text: string; failed: boolean } | null {
  if (state === 'connected') return null;
  if (state === 'failed' || state === 'closed') {
    return { text: strings.errors.peerFailed, failed: true };
  }
  return { text: strings.errors.peerConnecting, failed: false };
}

function VideoTileComponent({ participant, isSelf, connectionState, attachVideo }: VideoTileProps) {
  // У себя соединения нет по определению — своё видео локальное.
  const status = isSelf ? null : connectionStatus(connectionState);

  return (
    <figure className="tile">
      <div className="tile__media">
        <video
          className="tile__video"
          autoPlay
          playsInline
          // ★ self-view всегда заглушён: иначе гарантированное эхо (ФТ-18, TDD §4.7).
          muted={isSelf}
          ref={attachVideo}
        />

        {/* ★ Заглушка-силуэт поверх видео, а не вместо него (ФТ-18, риск R5). */}
        {!participant.media.video && (
          <div className="tile__placeholder">
            <svg
              className="tile__silhouette"
              viewBox="0 0 24 24"
              aria-hidden="true"
              focusable="false"
            >
              <circle cx="12" cy="8" r="4" fill="currentColor" />
              <path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" fill="currentColor" />
            </svg>
            {/* Имя выводится текстом в JSX — экранирование на выходе (ФТ-39). */}
            <span className="tile__placeholder-name">{participant.name}</span>
          </div>
        )}

        {/* Состояние соединения — плашкой поверх видео (задача 11.6, ФТ-34). */}
        {status && (
          <span
            className={status.failed ? 'tile__status tile__status--failed' : 'tile__status'}
            role="status"
          >
            {status.text}
          </span>
        )}

        {/* Иконка перечёркнутого микрофона (ФТ-16). */}
        {!participant.media.audio && (
          <span
            className="tile__mic"
            title={strings.a11y.micMuted}
            aria-label={strings.a11y.micMuted}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path
                d="M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM5 11a7 7 0 0 0 14 0M12 18v3"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              />
              <path d="M3 3l18 18" fill="none" stroke="currentColor" strokeWidth="2" />
            </svg>
          </span>
        )}
      </div>

      <figcaption className="tile__caption">
        {/* Имя — текстом в JSX: экранирование только на выходе (ФТ-39). */}
        {participant.name}
        {isSelf ? ` (${strings.room.you})` : ''}
      </figcaption>
    </figure>
  );
}

/**
 * ★ Задача 10.9: перерисовка только при изменении того, что видно на плитке.
 *
 * `attachVideo` в сравнении не участвует намеренно — но он **обязан быть
 * стабильным** по идентичности (`useRoomSession` кеширует колбэк на участника),
 * иначе memo бессмысленен. Поток присваивается через ref один раз и не зависит
 * от ре-рендеров.
 */
export const VideoTile = memo(VideoTileComponent, (prev, next) => {
  return (
    prev.participant.id === next.participant.id &&
    prev.participant.name === next.participant.name &&
    prev.participant.media.audio === next.participant.media.audio &&
    prev.participant.media.video === next.participant.media.video &&
    prev.isSelf === next.isSelf &&
    prev.connectionState === next.connectionState
  );
});
