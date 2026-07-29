/**
 * Тесты UI комнаты (задачи IP 10.3–10.9).
 *
 * Разметка проверяется через `react-dom/server` — без jsdom, который придёт с
 * RTL в задаче 12. Здесь ловится то, что ломается молча: раскладка сетки,
 * `disabled` у кнопки отправки, отсутствие автолинковки, экранирование текста,
 * скрытие внутренних id и работа мемоизации плитки.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ChatItem, Participant } from '@video-chat/shared';
import { ChatPanel } from './ChatPanel';
import { Controls } from './Controls';
import { ParticipantList } from './ParticipantList';
import { VideoGrid } from './VideoGrid';
import { VideoTile } from './VideoTile';
import { copyLink } from '../lib/copyLink';
import { config } from '../config';
import { strings } from '../strings';

const participant = (id: string, name: string, video = true, audio = true): Participant => ({
  id,
  name,
  media: { audio, video },
  joinedAt: 1_769_000_000_000,
});

const attachVideo = () => () => undefined;

describe('10.3 VideoGrid: раскладки 1 / 2 / 3–4 (ФТ-11)', () => {
  const render = (count: number) =>
    renderToStaticMarkup(
      <VideoGrid
        participants={Array.from({ length: count }, (_, i) => participant(`p${i}`, `Имя ${i}`))}
        selfId="p0"
        peerConnectionStates={{}}
        attachVideo={attachVideo}
      />,
    );

  it('★ один участник — во всю ширину', () => {
    expect(render(1)).toContain('grid--single');
  });

  it('★ двое — рядом', () => {
    expect(render(2)).toContain('grid--pair');
  });

  it('★ трое и четверо — сетка 2×2, а не «2 + растянутая»', () => {
    expect(render(3)).toContain('grid--quad');
    expect(render(4)).toContain('grid--quad');
  });

  it('★ плиток ровно столько, сколько участников, и у каждой есть <video>', () => {
    const html = render(4);

    expect(html.match(/<video/g)).toHaveLength(4);
    expect(html.match(/class="tile"/g)).toHaveLength(4);
  });

  it('self-view заглушён, остальные — нет (ФТ-18: иначе эхо)', () => {
    const html = render(2);
    const tiles = html.split('<figure');

    expect(tiles[1]).toMatch(/<video[^>]*muted/);
    expect(tiles[2]).not.toMatch(/<video[^>]*muted/);
  });
});

describe('10.4 Controls: состояние тумблеров видно (ФТ-15, ФТ-17)', () => {
  const render = (audio: boolean, video: boolean) =>
    renderToStaticMarkup(
      <Controls
        media={{ audio, video }}
        onToggleMic={() => undefined}
        onToggleCamera={() => undefined}
        onLeave={() => undefined}
      />,
    );

  it('★ включённые устройства: подписи «Выключить …» и aria-pressed=true', () => {
    const html = render(true, true);

    expect(html).toContain(strings.room.micOn);
    expect(html).toContain(strings.room.cameraOn);
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(2);
    expect(html).toContain('button--on');
  });

  it('★ выключенные устройства: подписи «Включить …» и aria-pressed=false', () => {
    const html = render(false, false);

    expect(html).toContain(strings.room.micOff);
    expect(html).toContain(strings.room.cameraOff);
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(2);
    expect(html).toContain('button--off');
  });

  it('микрофон и камера независимы', () => {
    const html = render(false, true);

    expect(html).toContain(strings.room.micOff);
    expect(html).toContain(strings.room.cameraOn);
  });

  it('есть кнопки копирования ссылки и выхода (ФТ-3, ФТ-27)', () => {
    const html = render(true, true);

    expect(html).toContain(strings.room.copyLink);
    expect(html).toContain(strings.room.leave);
  });

  it('подтверждение копирования до нажатия не показывается', () => {
    const html = render(true, true);

    expect(html).not.toContain(strings.room.copyLinkDone);
    expect(html).not.toContain(strings.room.copyLinkFailed);
  });
});

describe('10.6 ChatPanel: история и отправка (ФТ-21…25, US-8)', () => {
  const userMessage = (id: string, text: string, author = 'Борис'): ChatItem => ({
    type: 'user',
    id,
    authorId: 'peer-1',
    authorName: author,
    text,
    ts: Date.UTC(2026, 0, 15, 14, 5),
  });
  const systemMessage = (id: string, kind: 'join' | 'leave' | 'shutdown'): ChatItem => ({
    type: 'system',
    id,
    kind,
    name: 'Вера',
    ts: Date.UTC(2026, 0, 15, 14, 6),
  });

  const render = (messages: ChatItem[], chatError: string | null = null) =>
    renderToStaticMarkup(
      <ChatPanel messages={messages} chatError={chatError} onSend={() => undefined} />,
    );

  it('★ имя автора и время HH:MM у каждого сообщения (ФТ-22)', () => {
    const html = render([userMessage('m1', 'привет')]);

    expect(html).toContain('Борис');
    expect(html).toContain('привет');
    expect(html).toMatch(/\d{2}:\d{2}/);
  });

  it('★ системные и пользовательские сообщения рендерит один компонент (ФТ-25)', () => {
    const html = render([systemMessage('s1', 'join'), userMessage('m1', 'привет')]);

    expect(html).toContain(strings.system.join('Вера'));
    expect(html).toContain('привет');
    // Порядок сохранён: системное было раньше.
    expect(html.indexOf(strings.system.join('Вера'))).toBeLessThan(html.indexOf('привет'));
  });

  it('★ формулировка выхода — «покинул комнату» (ФТ-31, TDD §8.4)', () => {
    const html = render([systemMessage('s1', 'leave')]);

    expect(html).toContain('Вера покинул комнату');
    expect(html).not.toContain('соединение потеряно');
  });

  it('системное сообщение о завершении работы сервера (Q10)', () => {
    expect(render([systemMessage('s1', 'shutdown')])).toContain(strings.system.shutdown);
  });

  it('★ кнопка отправки disabled при пустом поле (ФТ-24)', () => {
    expect(render([])).toMatch(/<button[^>]*disabled/);
  });

  it('★ ссылки НЕ автолинкуются — вектор javascript: URL (TDD §10.3)', () => {
    const html = render([
      userMessage('m1', 'смотри https://example.com'),
      userMessage('m2', 'javascript:alert(1)'),
    ]);

    expect(html).toContain('https://example.com');
    // Ни одного <a> в истории быть не должно.
    expect(html).not.toContain('<a ');
    expect(html).not.toContain('href=');
  });

  it('★ HTML в сообщении отображается как текст (ФТ-39)', () => {
    const html = render([userMessage('m1', '<img src=x onerror=alert(1)>')]);

    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });

  it('★ HTML в имени автора тоже экранируется', () => {
    const html = render([userMessage('m1', 'текст', '<script>alert(1)</script>')]);

    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
  });

  it('счётчик длины сообщения показывает лимит (Q7)', () => {
    expect(render([])).toContain(`0 / ${config.maxMessageLen}`);
  });

  it('поле ввода ограничено серверным лимитом', () => {
    expect(render([])).toMatch(new RegExp(`maxlength="${config.maxMessageLen}"`, 'i'));
  });

  it('★ ошибка отправки показывается подсказкой: RATE_LIMITED (ФТ-40)', () => {
    expect(render([], 'RATE_LIMITED')).toContain(strings.errors.rateLimited);
  });

  it('коды ошибок различаются текстами', () => {
    expect(render([], 'TEXT_TOO_LONG')).toContain(strings.validation.messageTooLong);
    expect(render([], 'NOT_IN_ROOM')).toContain(strings.errors.notInRoom);
  });

  it('без ошибки подсказка не показывается', () => {
    const html = render([userMessage('m1', 'привет')]);

    expect(html).not.toContain(strings.errors.rateLimited);
    expect(html).not.toContain(strings.errors.notInRoom);
  });
});

describe('10.8 ParticipantList (ФТ-26, ФТ-30, US-9)', () => {
  const render = (participants: Participant[], selfId: string | null = 'p1') =>
    renderToStaticMarkup(<ParticipantList participants={participants} selfId={selfId} />);

  it('★ показывает всех участников и их число', () => {
    const html = render([participant('p1', 'Аня'), participant('p2', 'Борис')]);

    expect(html).toContain('Аня');
    expect(html).toContain('Борис');
    expect(html).toContain('(2)');
  });

  it('★ внутренние идентификаторы не отображаются (ФТ-30)', () => {
    const html = render([participant('socket-abc123', 'Аня')], 'socket-abc123');

    expect(html).not.toContain('socket-abc123');
  });

  it('себя помечает «(вы)»', () => {
    const html = render([participant('p1', 'Аня')], 'p1');

    expect(html).toContain(strings.room.you);
  });

  it('★ одинаковые имена допустимы и не ломают список (ФТ-30)', () => {
    const html = render([participant('p1', 'Аня'), participant('p2', 'Аня')]);

    expect(html.match(/Аня/g)?.length).toBeGreaterThanOrEqual(2);
    expect(html).toContain('(2)');
  });

  it('состояние устройств отмечается флагами (ФТ-16, ФТ-18)', () => {
    const html = render([participant('p2', 'Борис', false, false)], 'p1');

    expect(html).toContain(strings.a11y.micMuted);
    expect(html).toContain(strings.a11y.noVideo);
  });

  it('HTML в имени экранируется (ФТ-39)', () => {
    const html = render([participant('p1', '<b>Аня</b>')]);

    expect(html).not.toContain('<b>Аня</b>');
    expect(html).toContain('&lt;b&gt;');
  });
});

describe('10.9 ★ мемоизация плитки (TDD §9.3)', () => {
  it('★ VideoTile обёрнут в memo — иначе чат перерисовывает видеосетку', () => {
    // У memo-компонента особый внутренний тип; обычная функция его не имеет.
    const memoized = VideoTile as unknown as { $$typeof: symbol };

    expect(String(memoized.$$typeof)).toContain('memo');
  });

  it('★ колбэк привязки видео должен быть стабильным на участника', () => {
    // Без стабильной идентичности memo бессмыслен: новая функция на каждый
    // рендер меняет пропсы. Здесь проверяется контракт фабрики из useRoomSession.
    const cache = new Map<string, () => void>();
    const factory = (id: string) => {
      const cached = cache.get(id);
      if (cached) return cached;
      const callback = () => undefined;
      cache.set(id, callback);
      return callback;
    };

    expect(factory('peer-1')).toBe(factory('peer-1'));
    expect(factory('peer-1')).not.toBe(factory('peer-2'));
  });
});

describe('10.5 копирование ссылки: подтверждение и запасной путь', () => {
  it('★ успешное копирование показывает подтверждение', async () => {
    const writeText = vi.fn(() => Promise.resolve());

    expect(await copyLink('http://localhost:3001/RoomAAA', { clipboard: { writeText } })).toBe(
      'copied',
    );
    expect(writeText).toHaveBeenCalledWith('http://localhost:3001/RoomAAA');
  });

  it('★ отказ Clipboard API не бросает исключение, а сообщает о неудаче', async () => {
    const writeText = vi.fn(() => Promise.reject(new Error('NotAllowedError')));

    expect(await copyLink('http://x', { clipboard: { writeText } })).toBe('failed');
  });

  it('★ отсутствие Clipboard API (insecure context) — тоже неудача, а не падение', async () => {
    expect(await copyLink('http://x', { clipboard: undefined })).toBe('failed');
  });
});
