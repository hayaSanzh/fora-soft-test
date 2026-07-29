/**
 * Панель чата (задачи IP 10.6, 10.7; ФТ-21…25, US-8, TDD §7.5, §10.3).
 *
 * Три правила, каждое из которых — требование, а не оформление:
 *
 * 1. **Пользовательские и системные сообщения рендерит один компонент.** Они
 *    лежат в одной истории (ФТ-25), переигрываются позднему участнику и должны
 *    сохранять порядок между собой.
 * 2. **Ссылки не автолинкуются** (TDD §10.3). Автолинковка открывает вектор
 *    `javascript:` URL; расширенный чат вне scope, поэтому текст остаётся
 *    текстом. Экранирование даёт JSX — `dangerouslySetInnerHTML` запрещён
 *    ESLint-стражем (ФТ-39).
 * 3. **Отправка пустого сообщения невозможна** (ФТ-24): кнопка `disabled`,
 *    а валидация зеркальна серверной (схемы из `shared`).
 */
import { useId, useState, type FormEvent } from 'react';
import { isSystemChatItem, type ChatItem } from '@video-chat/shared';
import { useAutoScroll } from '../hooks/useAutoScroll';
import { formatTime } from '../lib/format';
import { checkMessage } from '../lib/validation';
import { config } from '../config';
import { strings } from '../strings';

export interface ChatPanelProps {
  messages: ChatItem[];
  /** Код ошибки последней отправки (`RATE_LIMITED` и т. п.), TDD §8.1. */
  chatError: string | null;
  onSend: (text: string) => void;
}

/** Текст системного сообщения по его виду (ФТ-25, формулировки — TDD §8.4). */
function systemText(item: Extract<ChatItem, { type: 'system' }>): string {
  switch (item.kind) {
    case 'join':
      return strings.system.join(item.name);
    case 'leave':
      // ★ «покинул комнату» и при выходе, и при обрыве: сервер их не различает.
      return strings.system.leave(item.name);
    case 'shutdown':
      return strings.system.shutdown;
  }
}

/** Подсказка у поля ввода по коду ошибки от сервера. */
function chatErrorText(code: string): string {
  switch (code) {
    case 'RATE_LIMITED':
      return strings.errors.rateLimited;
    case 'TEXT_TOO_LONG':
      return strings.validation.messageTooLong;
    case 'EMPTY_TEXT':
      return strings.validation.messageEmpty;
    default:
      return strings.errors.notInRoom;
  }
}

export function ChatPanel({ messages, chatError, onSend }: ChatPanelProps) {
  const [draft, setDraft] = useState('');
  const inputId = useId();
  // Автопрокрутка только если пользователь у нижней границы (задача 10.7).
  const listRef = useAutoScroll<HTMLUListElement>(messages.length);

  const check = checkMessage(draft);
  const used = draft.trim().length;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!check.ok) return;
    onSend(check.value);
    setDraft('');
  };

  return (
    <section className="chat" aria-label={strings.room.chatHeading}>
      <h2 className="chat__heading">{strings.room.chatHeading}</h2>

      <ul className="chat__list" ref={listRef}>
        {messages.map((item) =>
          isSystemChatItem(item) ? (
            <li className="chat__item chat__item--system" key={item.id}>
              <time className="chat__time">{formatTime(item.ts)}</time>{' '}
              <span>{systemText(item)}</span>
            </li>
          ) : (
            <li className="chat__item" key={item.id}>
              <time className="chat__time">{formatTime(item.ts)}</time>{' '}
              {/* Имя и текст — обычные текстовые узлы JSX (ФТ-39). */}
              <span className="chat__author">{item.authorName}</span>{' '}
              <span className="chat__text">{item.text}</span>
            </li>
          ),
        )}
      </ul>

      <form className="chat__form" onSubmit={handleSubmit}>
        <label className="visually-hidden" htmlFor={inputId}>
          {strings.room.chatPlaceholder}
        </label>
        <input
          id={inputId}
          className="input"
          type="text"
          autoComplete="off"
          maxLength={config.maxMessageLen}
          placeholder={strings.room.chatPlaceholder}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button className="button button--primary" type="submit" disabled={!check.ok}>
          {strings.room.send}
        </button>
      </form>

      <div className="chat__footer">
        {chatError ? (
          <span className="hint hint--error" role="status">
            {chatErrorText(chatError)}
          </span>
        ) : (
          <span className="hint" />
        )}
        <span className="counter">{strings.join.counter(used, config.maxMessageLen)}</span>
      </div>
    </section>
  );
}
