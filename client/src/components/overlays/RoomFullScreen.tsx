/**
 * Экран «Комната заполнена» (задача IP 11.1, ФТ-8, US-5, TDD §3.3, §8.1).
 *
 * ★ Кнопка «Повторить вход» обязана работать, а не быть украшением: сервер
 * отказал по лимиту участников, но кто-то мог уже выйти. `RETRY_JOIN` возвращает
 * машину в `acquiringMedia` — имя и комната уже известны, повторно спрашивать
 * имя не нужно.
 */
import { strings } from '../../strings';
import { ErrorScreen } from './ErrorScreen';

export interface RoomFullScreenProps {
  onRetry: () => void;
}

export function RoomFullScreen({ onRetry }: RoomFullScreenProps) {
  return (
    <ErrorScreen title={strings.errors.roomFullTitle} text={strings.errors.roomFullText}>
      <button className="button button--primary" type="button" onClick={onRetry}>
        {strings.errors.roomFullRetry}
      </button>
    </ErrorScreen>
  );
}
