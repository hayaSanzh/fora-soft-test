/**
 * Стартовый экран: ввод имени (задача IP 5.4, ФТ-1, ФТ-2, ФТ-38, US-1).
 *
 * Один компонент на два сценария: с `/` он создаёт комнату, с `/:roomId` —
 * входит в существующую. Разница только в подписи кнопки и подзаголовке, логика
 * та же, поэтому дублировать компонент не нужно.
 *
 * Валидация зеркальна серверной (схемы из `shared`), но подсказка про
 * обязательность имени показывается только после попытки отправки: иначе
 * пользователь видит ошибку, ещё ничего не напечатав.
 */
import { useId, useState, type FormEvent } from 'react';
import { config } from '../config';
import { checkName, nameLength } from '../lib/validation';
import { strings } from '../strings';

/**
 * ★ Условие показа подсказки под полем имени.
 *
 * Вынесено отдельной чистой функцией, потому что здесь легко сделать
 * неочевидную ошибку: если показывать подсказку только после отправки формы,
 * получается тупик — кнопка `disabled`, значит Enter не порождает `submit`,
 * значит объяснить, почему кнопка мертва, нечем. Этот дефект нашли на ручной
 * приёмке группы 5, и теперь он закреплён тестом.
 *
 * @param raw     сырое значение поля
 * @param touched пользователь уходил из поля или пытался отправить форму
 * @param valid   значение прошло валидацию
 */
export function shouldShowNameHint(raw: string, touched: boolean, valid: boolean): boolean {
  if (valid) return false;
  // Пустое поле молчит до первого касания: это исходное состояние формы,
  // а не ошибка пользователя.
  return touched || raw.trim().length > 0;
}

export interface JoinScreenProps {
  mode: 'create' | 'join';
  /** Получает уже очищенное имя — именно его отправлять на сервер. */
  onSubmit: (name: string) => void;
}

export function JoinScreen({ mode, onSubmit }: JoinScreenProps) {
  const [raw, setRaw] = useState('');
  const [touched, setTouched] = useState(false);
  const inputId = useId();
  const hintId = useId();

  const check = checkName(raw);
  const used = nameLength(raw);

  const showHint = shouldShowNameHint(raw, touched, check.ok);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!check.ok) return;
    onSubmit(check.value);
  };

  return (
    <main className="screen screen--center">
      <form className="card" onSubmit={handleSubmit} noValidate>
        <h1>{strings.join.heading}</h1>
        <p className="muted">
          {mode === 'create' ? strings.join.subtitleCreate : strings.join.subtitleJoin}
        </p>

        <label className="field" htmlFor={inputId}>
          {strings.join.nameLabel}
        </label>
        <input
          id={inputId}
          name="name"
          className="input"
          type="text"
          autoComplete="off"
          autoFocus
          // Ограничение на уровне поля: пользователь не сможет напечатать больше,
          // чем примет сервер. Валидация всё равно выполняется — maxLength не
          // мешает вставке из буфера в части браузеров.
          maxLength={config.maxNameLen}
          placeholder={strings.join.namePlaceholder}
          value={raw}
          aria-describedby={hintId}
          aria-invalid={showHint}
          onChange={(event) => setRaw(event.target.value)}
          // По уходу из поля показываем и подсказку про обязательность имени.
          onBlur={() => setTouched(true)}
        />

        <div className="field-footer">
          <span id={hintId} className={showHint ? 'hint hint--error' : 'hint'}>
            {showHint ? check.hint : strings.join.nameHint}
          </span>
          <span className="counter">{strings.join.counter(used, config.maxNameLen)}</span>
        </div>

        <button className="button button--primary" type="submit" disabled={!check.ok}>
          {mode === 'create' ? strings.join.createButton : strings.join.joinButton}
        </button>
      </form>
    </main>
  );
}
