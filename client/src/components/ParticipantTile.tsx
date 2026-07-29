/**
 * Плитка участника (задачи IP 10.1, 10.2 — вынесена раньше срока, см. ниже).
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
 * Компонент появился в группе 9 (а не 10) ровно из-за этого дефекта; задача 10.2
 * доводит оформление, а правила выше остаются.
 */
import type { Participant } from '@video-chat/shared';
import { strings } from '../strings';

export interface ParticipantTileProps {
  participant: Participant;
  isSelf: boolean;
  /** Состояние соединения для индикации (Q9, ФТ-34); у себя — не показывается. */
  connectionState?: RTCPeerConnectionState | undefined;
  /** `ref`-колбэк: привязка `<video>` к потоку (self-view или поток пира). */
  attachVideo: (element: HTMLVideoElement | null) => void;
}

/** Подпись состояния соединения; финальный вид — задача 11.6. */
function connectionHint(state: RTCPeerConnectionState | undefined): string | null {
  if (state === undefined || state === 'connected') return null;
  if (state === 'failed' || state === 'closed') return strings.errors.peerFailed;
  return strings.errors.peerConnecting;
}

export function ParticipantTile({
  participant,
  isSelf,
  connectionState,
  attachVideo,
}: ParticipantTileProps) {
  const hint = isSelf ? null : connectionHint(connectionState);

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
        {participant.name}
        {isSelf ? ` (${strings.room.you})` : ''}
        {hint ? ` · ${hint}` : ''}
      </figcaption>
    </figure>
  );
}
