/**
 * Экран ожидания: запрос устройств и подключение (группа 11, TDD §3.3).
 *
 * Отдельного номера в плане нет, но по требованию PRD «никогда не белый экран»
 * промежуточные состояния машины тоже должны что-то показывать. Оба состояния
 * короткие, однако запрос доступа к камере может ждать решения пользователя в
 * диалоге браузера сколько угодно долго.
 *
 * ★ Здесь же показывается баннер ошибки устройств: `MEDIA_FAILED` переводит
 * машину из `acquiringMedia` в `connecting`, и если вход по какой-то причине
 * задержится, пользователь должен уже видеть, что доступ к камере не получен
 * (ФТ-33) — а не узнать об этом только после попадания в комнату.
 */
import type { MediaState } from '@video-chat/shared';
import { strings } from '../../strings';
import type { MediaErrorKind } from '../../state/roomReducer';
import { MediaErrorBanner } from './MediaErrorBanner';

export interface StatusScreenProps {
  phase: 'acquiringMedia' | 'connecting';
  roomId: string;
  name: string;
  mediaError: MediaErrorKind | null;
  /** Фактическое состояние устройств — уточняет текст баннера. */
  media: MediaState;
  onDismissMediaError: () => void;
  onCancel: () => void;
}

export function StatusScreen({
  phase,
  roomId,
  name,
  mediaError,
  media,
  onDismissMediaError,
  onCancel,
}: StatusScreenProps) {
  return (
    <main className="screen screen--center">
      <div className="card">
        <h1>{strings.app.title}</h1>
        <p aria-live="polite">
          {phase === 'acquiringMedia' ? strings.room.acquiringMedia : strings.room.connecting}
        </p>
        <p className="muted">
          {strings.room.roomLabel} <code>{roomId}</code>, {strings.room.nameLabel}{' '}
          <strong>{name}</strong>.
        </p>

        {mediaError && (
          <MediaErrorBanner kind={mediaError} media={media} onDismiss={onDismissMediaError} />
        )}

        <button className="button" type="button" onClick={onCancel}>
          {strings.errors.leftBack}
        </button>
      </div>
    </main>
  );
}
