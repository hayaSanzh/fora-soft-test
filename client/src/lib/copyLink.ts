/**
 * Копирование ссылки-приглашения (задача IP 10.5, ФТ-3, US-3).
 *
 * Clipboard API доступен только в secure context и может отказать: пользователь
 * не давал разрешения, окно не в фокусе, браузер счёл вызов не жестом.
 * Поэтому у копирования обязателен **видимый исход** и запасной путь — иначе
 * пользователь думает, что ссылка скопирована, вставляет и получает не то.
 *
 * Fallback — не «ещё один способ скопировать», а честное «скопируйте из адресной
 * строки»: `document.execCommand('copy')` устарел и в части браузеров уже не
 * работает, поэтому обещать успех нельзя.
 */

export type CopyResult = 'copied' | 'failed';

export interface CopyLinkDeps {
  /** Обычно `navigator.clipboard`; отсутствует в insecure context. */
  clipboard?: Pick<Clipboard, 'writeText'> | undefined;
}

/**
 * Копирует переданный текст. Никогда не бросает: результат всегда виден в UI.
 */
export async function copyLink(text: string, deps: CopyLinkDeps = {}): Promise<CopyResult> {
  const clipboard =
    deps.clipboard ?? (typeof navigator !== 'undefined' ? navigator.clipboard : undefined);

  if (!clipboard || typeof clipboard.writeText !== 'function') return 'failed';

  try {
    await clipboard.writeText(text);
    return 'copied';
  } catch {
    return 'failed';
  }
}
