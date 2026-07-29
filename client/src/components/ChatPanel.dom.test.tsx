/**
 * Компонентные тесты панели чата (задача IP 12.3, ФТ-22, ФТ-24, ФТ-25, ФТ-39).
 *
 * Две вещи проверяются только здесь и больше нигде:
 *
 * 1. **Поведение поля ввода при наборе** — `disabled` у кнопки, очистка поля
 *    после отправки, срезание пробелов. Разметка при фиксированных пропсах этого
 *    не показывает.
 * 2. **★ Автопрокрутка** — до сих пор она проверялась как чистая функция
 *    (`isNearBottom`), а сам контейнер — нет. jsdom не считает раскладку, поэтому
 *    метрики прокрутки подставляются вручную; это единственный способ проверить
 *    правило «не выдёргивать пользователя из чтения истории» без браузера.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ChatItem } from '@video-chat/shared';
import { ChatPanel } from './ChatPanel';
import { config } from '../config';
import { strings } from '../strings';

afterEach(cleanup);

const userMessage = (id: string, text: string, authorName = 'Борис'): ChatItem => ({
  type: 'user',
  id,
  authorId: 'peer-1',
  authorName,
  text,
  ts: Date.UTC(2026, 0, 15, 14, 5),
});

const systemMessage = (id: string): ChatItem => ({
  type: 'system',
  id,
  kind: 'join',
  name: 'Вера',
  ts: Date.UTC(2026, 0, 15, 14, 6),
});

const input = () => screen.getByPlaceholderText(strings.room.chatPlaceholder);
const sendButton = () => screen.getByRole('button', { name: strings.room.send });

describe('12.3 ChatPanel: отправка сообщения (ФТ-21, ФТ-24)', () => {
  it('★ кнопка неактивна при пустом поле', () => {
    render(<ChatPanel messages={[]} chatError={null} onSend={() => undefined} />);

    expect(sendButton()).toBeDisabled();
  });

  it('★ кнопка неактивна, если введены только пробелы', async () => {
    const user = userEvent.setup();
    render(<ChatPanel messages={[]} chatError={null} onSend={() => undefined} />);

    await user.type(input(), '    ');

    expect(sendButton()).toBeDisabled();
  });

  it('★ появление текста активирует кнопку', async () => {
    const user = userEvent.setup();
    render(<ChatPanel messages={[]} chatError={null} onSend={() => undefined} />);

    await user.type(input(), 'привет');

    expect(sendButton()).toBeEnabled();
  });

  it('★ клик отправляет текст и очищает поле', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<ChatPanel messages={[]} chatError={null} onSend={onSend} />);

    await user.type(input(), 'привет');
    await user.click(sendButton());

    expect(onSend).toHaveBeenCalledWith('привет');
    expect(input()).toHaveValue('');
    expect(sendButton()).toBeDisabled();
  });

  it('★ Enter отправляет сообщение', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<ChatPanel messages={[]} chatError={null} onSend={onSend} />);

    await user.type(input(), 'привет{Enter}');

    expect(onSend).toHaveBeenCalledWith('привет');
  });

  it('★ крайние пробелы срезаются, внутренние сохраняются (TDD §10.3)', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<ChatPanel messages={[]} chatError={null} onSend={onSend} />);

    await user.type(input(), '  привет   всем  {Enter}');

    // ★ Отличие от имени участника: `sanitizeName` сворачивает внутренние
    // пробелы, `sanitizeText` — нет. Для сообщения это правильно: выравнивание
    // текста пробелами пользователь делает осознанно, и портить его нельзя.
    expect(onSend).toHaveBeenCalledWith('привет   всем');
  });

  it('★ Enter в пустом поле ничего не отправляет', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<ChatPanel messages={[]} chatError={null} onSend={onSend} />);

    await user.type(input(), '{Enter}');

    expect(onSend).not.toHaveBeenCalled();
  });

  it('★ счётчик обновляется при наборе, поле ограничено лимитом (Q7)', async () => {
    const user = userEvent.setup();
    render(<ChatPanel messages={[]} chatError={null} onSend={() => undefined} />);

    await user.type(input(), 'привет');
    expect(screen.getByText(`6 / ${config.maxMessageLen}`)).toBeInTheDocument();

    expect(input()).toHaveAttribute('maxlength', String(config.maxMessageLen));
  });
});

describe('12.3 ChatPanel: история (ФТ-22, ФТ-25, ФТ-39)', () => {
  it('★ имя автора, время HH:MM и текст', () => {
    render(
      <ChatPanel
        messages={[userMessage('m1', 'привет')]}
        chatError={null}
        onSend={() => undefined}
      />,
    );

    expect(screen.getByText('Борис')).toBeInTheDocument();
    expect(screen.getByText('привет')).toBeInTheDocument();
    expect(screen.getByText(/^\d{2}:\d{2}$/)).toBeInTheDocument();
  });

  it('★ системные и пользовательские сообщения в одной истории и в порядке', () => {
    const { container } = render(
      <ChatPanel
        messages={[systemMessage('s1'), userMessage('m1', 'привет')]}
        chatError={null}
        onSend={() => undefined}
      />,
    );

    const items = [...container.querySelectorAll('.chat__item')];
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toContain(strings.system.join('Вера'));
    expect(items[1]?.textContent).toContain('привет');
  });

  it('★ HTML в сообщении не становится разметкой (ФТ-39)', () => {
    const { container } = render(
      <ChatPanel
        messages={[userMessage('m1', '<img src=x onerror=alert(1)>')]}
        chatError={null}
        onSend={() => undefined}
      />,
    );

    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
  });

  it('★ ссылки не автолинкуются: вектор javascript: URL (TDD §10.3)', () => {
    const { container } = render(
      <ChatPanel
        messages={[
          userMessage('m1', 'смотри https://example.com'),
          userMessage('m2', 'javascript:alert(1)'),
        ]}
        chatError={null}
        onSend={() => undefined}
      />,
    );

    expect(container.querySelectorAll('a')).toHaveLength(0);
  });

  it('★ HTML в имени автора тоже остаётся текстом', () => {
    const { container } = render(
      <ChatPanel
        messages={[userMessage('m1', 'текст', '<b>Борис</b>')]}
        chatError={null}
        onSend={() => undefined}
      />,
    );

    expect(container.querySelector('b')).toBeNull();
    expect(screen.getByText('<b>Борис</b>')).toBeInTheDocument();
  });

  it('★ ошибка отправки показывается подсказкой и не мешает вводу (ФТ-40)', async () => {
    const user = userEvent.setup();
    render(<ChatPanel messages={[]} chatError="RATE_LIMITED" onSend={() => undefined} />);

    expect(screen.getByText(strings.errors.rateLimited)).toBeInTheDocument();

    // Ввод не заблокирован: сообщение можно отправить через пару секунд.
    await user.type(input(), 'ещё раз');
    expect(sendButton()).toBeEnabled();
  });
});

describe('12.3 ★ автопрокрутка (ФТ-23, US-8)', () => {
  /** jsdom не считает раскладку — метрики прокрутки задаются вручную. */
  function fakeMetrics(list: Element, scrollHeight: number, clientHeight: number) {
    Object.defineProperty(list, 'scrollHeight', { configurable: true, value: scrollHeight });
    Object.defineProperty(list, 'clientHeight', { configurable: true, value: clientHeight });
  }

  const history = (count: number) =>
    Array.from({ length: count }, (_, i) => userMessage(`m${i}`, `сообщение ${i}`));

  it('★ пользователь внизу — новое сообщение прокручивает список', () => {
    const { container, rerender } = render(
      <ChatPanel messages={history(20)} chatError={null} onSend={() => undefined} />,
    );
    const list = container.querySelector('.chat__list');
    if (!list) throw new Error('список истории не найден');

    fakeMetrics(list, 1000, 200);
    // Пользователь у нижней границы: 1000 - 800 - 200 = 0.
    list.scrollTop = 800;
    list.dispatchEvent(new Event('scroll'));

    rerender(<ChatPanel messages={history(21)} chatError={null} onSend={() => undefined} />);

    expect(list.scrollTop).toBe(1000);
  });

  it('★ пользователь листает историю вверх — список НЕ дёргается вниз', () => {
    const { container, rerender } = render(
      <ChatPanel messages={history(20)} chatError={null} onSend={() => undefined} />,
    );
    const list = container.querySelector('.chat__list');
    if (!list) throw new Error('список истории не найден');

    fakeMetrics(list, 1000, 200);
    // Далеко от низа: 1000 - 100 - 200 = 700.
    list.scrollTop = 100;
    list.dispatchEvent(new Event('scroll'));

    rerender(<ChatPanel messages={history(21)} chatError={null} onSend={() => undefined} />);

    expect(list.scrollTop).toBe(100);
  });

  it('★ «почти внизу» считается «внизу»: порог из конфигурации', () => {
    const { container, rerender } = render(
      <ChatPanel messages={history(20)} chatError={null} onSend={() => undefined} />,
    );
    const list = container.querySelector('.chat__list');
    if (!list) throw new Error('список истории не найден');

    fakeMetrics(list, 1000, 200);
    // Отступ от низа меньше порога — пользователь воспринимает это как «внизу».
    list.scrollTop = 800 - (config.autoScrollThresholdPx - 1);
    list.dispatchEvent(new Event('scroll'));

    rerender(<ChatPanel messages={history(21)} chatError={null} onSend={() => undefined} />);

    expect(list.scrollTop).toBe(1000);
  });

  it('★ вернулся вниз — автопрокрутка снова работает', () => {
    const { container, rerender } = render(
      <ChatPanel messages={history(20)} chatError={null} onSend={() => undefined} />,
    );
    const list = container.querySelector('.chat__list');
    if (!list) throw new Error('список истории не найден');

    fakeMetrics(list, 1000, 200);
    list.scrollTop = 100;
    list.dispatchEvent(new Event('scroll'));
    rerender(<ChatPanel messages={history(21)} chatError={null} onSend={() => undefined} />);
    expect(list.scrollTop).toBe(100);

    // Пользователь домотал до низа.
    list.scrollTop = 800;
    list.dispatchEvent(new Event('scroll'));
    rerender(<ChatPanel messages={history(22)} chatError={null} onSend={() => undefined} />);

    expect(list.scrollTop).toBe(1000);
  });
});
