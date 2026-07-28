/**
 * Экран несовместимости (задача IP 5.1; окончательный вид — задача 11.3).
 *
 * Показывается **до монтирования остального приложения** (ФТ-36, US-13):
 * пользователь старого браузера должен получить объяснение, а не белый экран
 * после падения первого обращения к WebRTC.
 */
import { strings } from '../../strings';
import type { UnsupportedKind } from '../../state/roomReducer';

export interface UnsupportedScreenProps {
  kind: UnsupportedKind;
}

export function UnsupportedScreen({ kind }: UnsupportedScreenProps) {
  return (
    <main className="screen screen--center">
      <div className="card">
        <h1>{strings.errors.unsupportedTitle}</h1>
        <p>
          {kind === 'INSECURE_CONTEXT'
            ? strings.errors.insecureContextText
            : strings.errors.unsupportedText}
        </p>
      </div>
    </main>
  );
}
