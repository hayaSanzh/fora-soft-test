/**
 * Экран несовместимости (задачи IP 5.1 и 11.3, ФТ-36, US-13).
 *
 * Показывается **до монтирования остального приложения**: пользователь старого
 * браузера должен получить объяснение, а не белый экран после падения первого
 * обращения к WebRTC.
 *
 * ★ Кнопки действия нет намеренно — и это единственный такой экран. Выйти из
 * состояния внутри приложения невозможно: нужен другой браузер или HTTPS.
 * Ложная кнопка «Повторить» здесь только вводила бы в заблуждение.
 *
 * ★ Разные тексты для двух причин: «браузер не умеет WebRTC» и «страница открыта
 * без HTTPS» требуют совершенно разных действий, а признак у них один — доступа
 * к `navigator.mediaDevices` нет (см. `lib/support.ts`).
 */
import { strings } from '../../strings';
import type { UnsupportedKind } from '../../state/roomReducer';
import { ErrorScreen } from './ErrorScreen';

export interface UnsupportedScreenProps {
  kind: UnsupportedKind;
}

export function UnsupportedScreen({ kind }: UnsupportedScreenProps) {
  return (
    <ErrorScreen
      title={strings.errors.unsupportedTitle}
      text={
        kind === 'INSECURE_CONTEXT'
          ? strings.errors.insecureContextText
          : strings.errors.unsupportedText
      }
    />
  );
}
