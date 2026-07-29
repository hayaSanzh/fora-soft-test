/**
 * Оверлей «Включить звук» (задача IP 11.5, ФТ-37, US-13, TDD §4.7, риск R6).
 *
 * Поднимается, когда браузер отклонил `play()` по политике автозапуска. Один
 * клик по кнопке — это жест пользователя, и в его обработчике `play()`
 * повторяется для **всех** элементов сразу (см. `lib/autoplay.ts`).
 *
 * ★ Почему оверлеем поверх сетки, а не строкой-подсказкой: без звука звонок не
 * работает, но выглядит работающим — видео идёт, участники на месте. Подсказку
 * внизу пользователь не заметит и решит, что собеседник молчит.
 */
import { strings } from '../../strings';

export interface UnmuteAudioGateProps {
  onEnable: () => void;
}

export function UnmuteAudioGate({ onEnable }: UnmuteAudioGateProps) {
  return (
    <div className="gate" role="alert">
      <div className="gate__card">
        <p className="gate__text">{strings.errors.audioBlockedText}</p>
        <button className="button button--primary gate__button" type="button" onClick={onEnable}>
          {strings.errors.audioBlockedButton}
        </button>
      </div>
    </div>
  );
}
