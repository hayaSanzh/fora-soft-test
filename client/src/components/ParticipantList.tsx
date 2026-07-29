/**
 * Список участников (задача IP 10.8, ФТ-26, ФТ-30, US-9).
 *
 * ★ Внутренние идентификаторы **не отображаются** (ФТ-30): `socket.id` служит
 * только для различения одинаковых имён в состоянии, но в интерфейсе его быть
 * не должно. Одинаковые имена в комнате допустимы, и это не ошибка.
 *
 * Список обновляется в реальном времени: он рендерится из состояния, которое
 * ведёт reducer по событиям `peer:joined` / `peer:left` / `media:state`.
 */
import type { Participant } from '@video-chat/shared';
import { strings } from '../strings';

export interface ParticipantListProps {
  participants: Participant[];
  selfId: string | null;
}

export function ParticipantList({ participants, selfId }: ParticipantListProps) {
  return (
    <section className="participants" aria-label={strings.room.participants}>
      <h2 className="participants__heading">
        {strings.room.participants} ({participants.length})
      </h2>
      <ul className="participants__list">
        {participants.map((participant) => (
          <li className="participants__item" key={participant.id}>
            <span>{participant.name}</span>
            {participant.id === selfId && (
              <span className="participants__self"> ({strings.room.you})</span>
            )}
            {/* Состояние устройств — из `media:state`, не из WebRTC (TDD §4.4). */}
            {!participant.media.audio && (
              <span className="participants__flag" title={strings.a11y.micMuted}>
                {' '}
                🎤̶
              </span>
            )}
            {!participant.media.video && (
              <span className="participants__flag" title={strings.a11y.noVideo}>
                {' '}
                📷̶
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
