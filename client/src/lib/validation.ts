/**
 * Клиентская валидация (задача IP 5.4, ФТ-38, US-1, TDD §10.3).
 *
 * **Зеркало серверной, но не замена ей**: схемы берутся из `shared`, поэтому
 * правила физически не могут разъехаться. Клиент отвечает за UX (подсказка до
 * отправки, disabled-кнопка), сервер — за безопасность.
 *
 * Здесь же коды ошибок превращаются в русский текст: контракт передаёт коды
 * (`INVALID_NAME`), а строки живут в `strings.ts`.
 */
import {
  DEFAULT_MAX_NAME_LEN,
  makeNameSchema,
  makeTextSchema,
  sanitizeName,
  validate,
} from '@video-chat/shared';
import { config } from '../config';
import { strings } from '../strings';

const nameSchema = makeNameSchema(config.maxNameLen);
const textSchema = makeTextSchema(config.maxMessageLen);

export interface FieldCheck {
  ok: boolean;
  /** Очищенное значение — именно оно уходит на сервер. */
  value: string;
  /** Готовый к показу текст подсказки; `null`, если ошибок нет. */
  hint: string | null;
}

/**
 * Проверяет имя участника.
 *
 * Пустое поле — не «ошибка ввода», а исходное состояние формы, поэтому
 * подсказка про обязательность отделена от подсказки про недопустимые символы:
 * иначе пользователь видит упрёк ещё до того, как что-то напечатал.
 */
export function checkName(raw: string): FieldCheck {
  const cleaned = sanitizeName(raw);
  if (cleaned.length === 0) {
    return { ok: false, value: '', hint: strings.validation.nameRequired };
  }
  if (cleaned.length > config.maxNameLen) {
    return { ok: false, value: cleaned, hint: strings.validation.nameTooLong };
  }
  const result = validate(nameSchema, raw);
  if (!result.ok) {
    return { ok: false, value: cleaned, hint: strings.validation.nameInvalidChars };
  }
  return { ok: true, value: result.value, hint: null };
}

/** Проверяет текст сообщения чата (ФТ-24, Q7). */
export function checkMessage(raw: string): FieldCheck {
  const result = validate(textSchema, raw);
  if (result.ok) return { ok: true, value: result.value, hint: null };
  return {
    ok: false,
    value: raw.trim(),
    hint:
      result.error === 'TEXT_TOO_LONG'
        ? strings.validation.messageTooLong
        : strings.validation.messageEmpty,
  };
}

/**
 * Длина имени для счётчика в UI. Считается по очищенному значению: иначе
 * счётчик показывает символы, которые всё равно будут вырезаны.
 */
export function nameLength(raw: string): number {
  return sanitizeName(raw).length;
}

export { DEFAULT_MAX_NAME_LEN };
