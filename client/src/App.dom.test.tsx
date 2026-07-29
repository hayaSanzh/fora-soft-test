/**
 * Компонентный тест роутинга (задача IP 12, ФТ-2, ФТ-3, ФТ-28, US-2).
 *
 * Дыру нашло покрытие группы 12: `App.tsx` не исполнялся ни одним тестом, то
 * есть **сценарий «создать комнату» не был покрыт вовсе** — он проверялся только
 * руками. А в нём три требования разом: генерация `roomId` на клиенте, переход
 * на URL комнаты и передача имени **не через URL** (ссылкой делятся, web storage
 * запрещён PRD §5).
 *
 * ★ Здесь используется настоящий `BrowserRouter` поверх history из jsdom, а не
 * `MemoryRouter`: подменив роутер, мы бы проверили не `App`, а его копию.
 * Сессия комнаты после перехода не проверяется — это область E2E (группа 13);
 * `navigator.mediaDevices` подменён так, чтобы запрос устройств завершился
 * штатным отказом, а не падением в jsdom.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';
import { clearPendingJoin } from './lib/pendingJoin';
import { strings } from './strings';

/** Отказ в доступе к устройствам: путь, который клиент обязан переживать (ФТ-33). */
let getUserMedia = vi.fn();

function stubMediaDevices() {
  const error = new Error('NotAllowedError');
  error.name = 'NotAllowedError';
  getUserMedia = vi.fn(() => Promise.reject(error));
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
  });
}

beforeEach(() => {
  stubMediaDevices();
  window.history.pushState({}, '', '/');
});

afterEach(() => {
  cleanup();
  clearPendingJoin();
  window.history.pushState({}, '', '/');
});

describe('12 App: создание комнаты (ФТ-2, US-2)', () => {
  it('★ на «/» показывается экран создания комнаты', () => {
    render(<App />);

    expect(screen.getByRole('button', { name: strings.join.createButton })).toBeInTheDocument();
    expect(screen.getByText(strings.join.subtitleCreate)).toBeInTheDocument();
  });

  it('★ ввод имени и «Создать комнату» переводят на URL комнаты', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByLabelText(strings.join.nameLabel), 'Аня');
    await user.click(screen.getByRole('button', { name: strings.join.createButton }));

    // roomId генерируется на клиенте: nanoid(12) из разрешённых символов.
    await waitFor(() => expect(window.location.pathname).toMatch(/^\/[A-Za-z0-9_-]{12}$/));
  });

  it('★ имя НЕ попадает в URL: ссылкой делятся с другими (ФТ-3)', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByLabelText(strings.join.nameLabel), 'Аня');
    await user.click(screen.getByRole('button', { name: strings.join.createButton }));

    await waitFor(() => expect(window.location.pathname).not.toBe('/'));
    expect(window.location.href).not.toContain('Аня');
    expect(window.location.search).toBe('');
  });

  it('★ после перехода имя второй раз не спрашивают', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByLabelText(strings.join.nameLabel), 'Аня');
    await user.click(screen.getByRole('button', { name: strings.join.createButton }));

    // Имя передано в памяти модуля (`pendingJoin`), поэтому экран ввода пропущен.
    await waitFor(() => expect(window.location.pathname).not.toBe('/'));
    expect(screen.queryByLabelText(strings.join.nameLabel)).toBeNull();
    expect(screen.queryByRole('button', { name: strings.join.createButton })).toBeNull();
  });
});

describe('12 App: вход по ссылке (ФТ-4, ФТ-28, US-4)', () => {
  it('★ переход по ссылке-приглашению спрашивает имя', () => {
    window.history.pushState({}, '', '/RoomAAAAAAAA');
    render(<App />);

    expect(screen.getByRole('button', { name: strings.join.joinButton })).toBeInTheDocument();
    expect(screen.getByText(strings.join.subtitleJoin)).toBeInTheDocument();
  });

  it('★ битая ссылка объясняет причину, а не показывает пустой экран', () => {
    // Короче минимума `ROOM_ID_PATTERN`; состояния «комната не найдена» нет (ФТ-5).
    window.history.pushState({}, '', '/ab');
    render(<App />);

    expect(screen.getByText(strings.errors.invalidLinkTitle)).toBeInTheDocument();
  });

  it('★ отказ в доступе к устройствам не останавливает вход (ФТ-33)', async () => {
    const user = userEvent.setup();
    window.history.pushState({}, '', '/RoomAAAAAAAA');
    render(<App />);

    await user.type(screen.getByLabelText(strings.join.nameLabel), 'Борис');
    await user.click(screen.getByRole('button', { name: strings.join.joinButton }));

    // Устройства запрошены и отказали.
    await waitFor(() => expect(getUserMedia).toHaveBeenCalled());

    /*
     * ★ Проверяется отсутствие тупика: экрана ввода имени больше нет, и вход
     * продолжился без устройств.
     *
     * Про исход подключения к серверу здесь **намеренно ничего не утверждается**:
     * сокет пошёл бы на реальный адрес, и результат зависел бы от того, запущен
     * ли в этот момент сервер разработки. Сквозная проверка входа — E2E
     * (группа 13), а сам путь «медиа отказало → вход продолжается» покрыт
     * тестами reducer'а и стендом 12.4.
     */
    expect(screen.queryByLabelText(strings.join.nameLabel)).toBeNull();
  });
});
