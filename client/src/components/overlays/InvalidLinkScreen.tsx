/**
 * Экран повреждённой ссылки (группа 11, TDD §5.3, §8.1).
 *
 * Показывается, когда `roomId` из URL не проходит схему. Состояния «комната не
 * найдена» не существует (ФТ-5): любой валидный идентификатор создаёт комнату,
 * поэтому единственная причина попасть сюда — испорченная ссылка.
 *
 * ★ Единственный экран этого семейства со ссылкой роутера, поэтому он и
 * отделён от `ErrorScreen`: та оболочка используется и вне контекста роутера.
 */
import { Link } from 'react-router-dom';
import { strings } from '../../strings';
import { ErrorScreen } from './ErrorScreen';

export function InvalidLinkScreen() {
  return (
    <ErrorScreen title={strings.errors.invalidLinkTitle} text={strings.errors.invalidLinkText}>
      <Link className="button button--primary" to="/">
        {strings.join.createButton}
      </Link>
    </ErrorScreen>
  );
}
