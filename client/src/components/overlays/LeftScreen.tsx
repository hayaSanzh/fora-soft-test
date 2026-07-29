/**
 * Экран после собственного выхода (группа 11, ФТ-27, US-10, TDD §3.3).
 *
 * Отдельного номера в плане нет, но состояние `left` — часть того же семейства:
 * без экрана пользователь после нажатия «Выйти» увидел бы пустую страницу.
 * Возврат ведёт в `idle`, то есть имя спрашивается заново (ФТ-28).
 */
import { strings } from '../../strings';
import { ErrorScreen } from './ErrorScreen';

export interface LeftScreenProps {
  onBack: () => void;
}

export function LeftScreen({ onBack }: LeftScreenProps) {
  return (
    <ErrorScreen title={strings.errors.leftTitle} text={strings.errors.leftText}>
      <button className="button button--primary" type="button" onClick={onBack}>
        {strings.errors.leftBack}
      </button>
    </ErrorScreen>
  );
}
