/**
 * Экран «Нет связи с сервером» (задача IP 11.2, ФТ-35, US-13, TDD §8.1, §8.3).
 *
 * ★ Один текст на два случая: сервер не ответил при входе и соединение
 * прервалось во время звонка. Различать их для пользователя бессмысленно —
 * действие одно и то же, а формулировка «соединение потеряно» про **чужой**
 * выход запрещена ФТ-31 и здесь не используется вовсе.
 *
 * Ошибка сокета — единственная терминальная (TDD §8.3): без сигналинга нет ни
 * presence, ни чата, поэтому это полноэкранное состояние, а не баннер.
 */
import { strings } from '../../strings';
import { ErrorScreen } from './ErrorScreen';

export interface ServerErrorScreenProps {
  onRetry: () => void;
}

export function ServerErrorScreen({ onRetry }: ServerErrorScreenProps) {
  return (
    <ErrorScreen title={strings.errors.serverErrorTitle} text={strings.errors.serverErrorText}>
      <button className="button button--primary" type="button" onClick={onRetry}>
        {strings.errors.serverErrorRetry}
      </button>
    </ErrorScreen>
  );
}
