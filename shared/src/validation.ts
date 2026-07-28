/**
 * Валидация входящих данных (задача IP 2.3, TDD §10.3).
 *
 * Три принципа, из которых следует всё остальное:
 *
 * 1. **Whitelist, а не blacklist** (ФТ-38). Разрешён явный набор символов, и
 *    `<`, `>`, `&`, кавычки, эмодзи-ZWJ и управляющие символы отсекаются
 *    автоматически — потому что не входят в разрешённый набор, а не потому что
 *    кто-то перечислил их в чёрном списке.
 * 2. **Клиентская валидация зеркальна серверной, но не заменяет её.** Схемы
 *    лежат в `shared/`, чтобы не разъезжались: клиент даёт UX, сервер — защиту.
 * 3. **Текст сообщения не экранируется при приёме.** Он хранится как есть, а
 *    экранируется только на выходе средствами JSX (TDD §10.3). Двойного
 *    экранирования нет, дырок тоже.
 */

import { z } from 'zod';
import {
  CONTROL_CHARS_PATTERN,
  DEFAULT_MAX_MESSAGE_LEN,
  DEFAULT_MAX_NAME_LEN,
  INVISIBLE_CHARS_PATTERN,
  ROOM_ID_PATTERN,
} from './limits.js';
import type { MediaState } from './types.js';

/** Разрешённые в имени символы: буквы и цифры любого алфавита, пробел, `.`, `_`, `-`. */
const NAME_BODY_CHARS = '\\p{L}\\p{N} ._-';

/**
 * Имя обязано **начинаться** с буквы или цифры: иначе допустимы значения вида
 * `---` и `. `, визуально не читаемые как имя.
 */
function nameRegExp(maxLen: number): RegExp {
  return new RegExp(`^[\\p{L}\\p{N}][${NAME_BODY_CHARS}]{0,${Math.max(0, maxLen - 1)}}$`, 'u');
}

/** Убирает управляющие и zero-width символы и сворачивает пробелы (TDD §10.3). */
export function sanitizeName(raw: string): string {
  return raw.replace(INVISIBLE_CHARS_PATTERN, '').replace(/\s+/gu, ' ').trim();
}

/** Убирает управляющие символы, сохраняя переводы строк и табуляцию. */
export function sanitizeText(raw: string): string {
  return raw.replace(CONTROL_CHARS_PATTERN, '').trim();
}

/**
 * Схема имени участника (ФТ-1, ФТ-38, US-1).
 *
 * Возвращает **очищенное** имя: вызывающий код обязан использовать результат
 * `parse`, а не исходную строку, иначе санитизация не имеет смысла.
 */
export function makeNameSchema(maxLen: number = DEFAULT_MAX_NAME_LEN) {
  const pattern = nameRegExp(maxLen);
  return z
    .string()
    .transform(sanitizeName)
    .refine((s) => s.length >= 1 && s.length <= maxLen, 'INVALID_NAME')
    .refine((s) => pattern.test(s), 'INVALID_NAME');
}

/**
 * Схема текста сообщения (ФТ-21, ФТ-24, Q7).
 *
 * Разные коды ошибок для пустого и слишком длинного текста: клиент показывает
 * разные подсказки (TDD §8.1).
 */
export function makeTextSchema(maxLen: number = DEFAULT_MAX_MESSAGE_LEN) {
  return z
    .string()
    .transform(sanitizeText)
    .refine((s) => s.length >= 1, 'EMPTY_TEXT')
    .refine((s) => s.length <= maxLen, 'TEXT_TOO_LONG');
}

/** Схема `roomId` из URL (TDD §5.3). */
export const roomIdSchema = z.string().regex(ROOM_ID_PATTERN, 'INVALID_ROOM_ID');

/** Схемы с дефолтными лимитами — то, что использует клиент. */
export const nameSchema = makeNameSchema();
export const textSchema = makeTextSchema();

/** Состояние устройств: приходит и в `room:join`, и в `media:state`. */
export const mediaStateSchema: z.ZodType<MediaState> = z.object({
  audio: z.boolean(),
  video: z.boolean(),
});

/** Результат проверки для UI: причина отказа нужна как код, а не как текст. */
export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Обёртка над `safeParse`, отдающая код ошибки первой сработавшей проверки.
 * Нужна и клиенту (подсказка у поля), и серверу (код в ack) — поэтому здесь.
 */
export function validate<T>(schema: z.ZodType<T>, input: unknown): ValidationResult<T> {
  const result = schema.safeParse(input);
  if (result.success) return { ok: true, value: result.data };
  const code = result.error.issues[0]?.message ?? 'INVALID';
  return { ok: false, error: code };
}
