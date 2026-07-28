/**
 * Форматирование времени сообщений (задача IP 5.6, ФТ-22, TDD §9.3).
 *
 * Два требования сходятся в одном месте:
 *
 * 1. **Время — локальное для клиента.** Сервер присылает `ts` (epoch ms), а
 *    «HH:MM» вычисляется здесь: форматирование на сервере нарушило бы ФТ-22 для
 *    участников из разных часовых поясов.
 * 2. **Форматтер кешируется.** `new Intl.DateTimeFormat()` на каждое сообщение
 *    заметен в чате с активной перепиской: создание форматтера на порядок
 *    дороже самого форматирования.
 */

let cachedFormatter: Intl.DateTimeFormat | null = null;

function getFormatter(): Intl.DateTimeFormat {
  cachedFormatter ??= new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return cachedFormatter;
}

/**
 * `1769000000000` → `"12:33"` в локали и часовом поясе клиента.
 *
 * Некорректный `ts` не должен ломать рендер всей истории чата: сообщение
 * останется без времени, но останется читаемым.
 */
export function formatTime(ts: number): string {
  if (!Number.isFinite(ts)) return '';
  const formatted = getFormatter().format(new Date(ts));
  // Часть локалей (например en-US с hour12) добавляет суффиксы и узкие
  // пробелы — приводим к чистому HH:MM, как требует ФТ-22.
  return formatted.replace(/[\u00A0\u202F\u2009]/gu, ' ').trim();
}

/** Сбрасывает кеш форматтера. Нужно только тестам, меняющим локаль. */
export function resetTimeFormatter(): void {
  cachedFormatter = null;
}
