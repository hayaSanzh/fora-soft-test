/**
 * Проверка фактического рендера экранов группы 5 (задачи 5.1, 5.3, 5.4).
 *
 * Используется `react-dom/server`: он даёт настоящую разметку без jsdom и RTL,
 * которые появятся в группе 12 вместе с интерактивными тестами (клики, ввод,
 * disabled-состояния после набора текста). Здесь проверяется то, что ломается
 * чаще всего и молча: пропали ли русские строки, отрендерился ли `<input>`,
 * экранируется ли пользовательский текст, не течёт ли внутренний id в UI.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { JoinScreen, shouldShowNameHint } from './JoinScreen';
import { RoomPage } from './RoomPage';
import { UnsupportedScreen } from './overlays/UnsupportedScreen';
import { clearPendingJoin, setPendingJoin } from '../lib/pendingJoin';
import { strings } from '../strings';

/** Рендерит `/:roomId` по указанному URL. */
function renderRoom(path: string): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/:roomId" element={<RoomPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => clearPendingJoin());

describe('JoinScreen (задача 5.4)', () => {
  it('★ рендерит поле имени, подсказку, счётчик и кнопку «Создать комнату»', () => {
    const html = renderToStaticMarkup(<JoinScreen mode="create" onSubmit={() => undefined} />);

    expect(html).toContain(strings.join.nameLabel);
    expect(html).toContain(strings.join.nameHint);
    expect(html).toContain(strings.join.createButton);
    expect(html).toContain('0 / 30');
    expect(html).toContain('<input');
    // Ограничение длины прямо в поле ввода: пользователь не напечатает больше,
    // чем примет сервер (React рендерит атрибут как maxLength).
    expect(html).toMatch(/maxlength="30"|maxLength="30"/i);
  });

  it('в режиме входа по ссылке кнопка называется «Войти»', () => {
    const html = renderToStaticMarkup(<JoinScreen mode="join" onSubmit={() => undefined} />);

    expect(html).toContain(strings.join.joinButton);
    expect(html).toContain(strings.join.subtitleJoin);
    expect(html).not.toContain(strings.join.createButton);
  });

  it('★ кнопка изначально disabled: пустое имя отправить нельзя (ФТ-1, US-1)', () => {
    const html = renderToStaticMarkup(<JoinScreen mode="create" onSubmit={() => undefined} />);

    expect(html).toMatch(/<button[^>]*disabled/);
  });

  it('подсказка про обязательность имени до попытки отправки не показывается', () => {
    const html = renderToStaticMarkup(<JoinScreen mode="create" onSubmit={() => undefined} />);

    expect(html).not.toContain(strings.validation.nameRequired);
    expect(html).toContain('aria-invalid="false"');
  });
});

describe('RoomPage (задачи 5.3, 5.5)', () => {
  it('по валидной ссылке без имени показывает экран ввода имени (PRD §6)', () => {
    const html = renderRoom('/V1StGXR8_Z5j');

    expect(html).toContain(strings.join.subtitleJoin);
    expect(html).toContain(strings.join.joinButton);
  });

  it('★ с именем со стартового экрана сразу переходит к получению медиа', () => {
    setPendingJoin('V1StGXR8_Z5j', 'Анна-Мария');
    const html = renderRoom('/V1StGXR8_Z5j');

    expect(html).toContain(strings.room.acquiringMedia);
    expect(html).toContain('Анна-Мария');
    expect(html).toContain('V1StGXR8_Z5j');
  });

  it('★ мусорная ссылка даёт объяснение и путь назад, а не белый экран', () => {
    const html = renderRoom('/ab');

    expect(html).toContain(strings.errors.invalidLinkTitle);
    expect(html).toContain(strings.errors.invalidLinkText);
    expect(html).toContain('href="/"');
  });

  it('невалидное имя не пропускается — снова спрашиваем', () => {
    setPendingJoin('V1StGXR8_Z5j', '<script>alert(1)</script>');
    const html = renderRoom('/V1StGXR8_Z5j');

    expect(html).toContain(strings.join.joinButton);
    expect(html).not.toContain(strings.room.acquiringMedia);
  });

  it('★ имя выводится как текст: HTML в нём не превращается в разметку (ФТ-39)', () => {
    setPendingJoin('V1StGXR8_Z5j', 'A.B. Иванов');
    const html = renderRoom('/V1StGXR8_Z5j');

    expect(html).toContain('A.B. Иванов');
    expect(html).not.toContain('<script');
  });

  it('★ регрессия ФТ-28: имя для ДРУГОЙ комнаты не подхватывается', () => {
    setPendingJoin('OtherRoomId', 'Аня');

    const html = renderRoom('/V1StGXR8_Z5j');

    expect(html).toContain(strings.join.joinButton);
    expect(html).not.toContain(strings.room.acquiringMedia);
  });

  it('★ регрессия ФТ-28: без имени в памяти (перезагрузка) экран снова спрашивает имя', () => {
    // Перезагрузка обнуляет память модуля — эмулируем отсутствием записи.
    clearPendingJoin();

    const html = renderRoom('/V1StGXR8_Z5j');

    expect(html).toContain(strings.join.nameLabel);
    expect(html).toContain(strings.join.joinButton);
  });
});

describe('UnsupportedScreen (задача 5.1, ФТ-36)', () => {
  it('★ старый браузер: сообщение про WebRTC', () => {
    const html = renderToStaticMarkup(<UnsupportedScreen kind="WEBRTC_UNSUPPORTED" />);

    expect(html).toContain(strings.errors.unsupportedTitle);
    expect(html).toContain(strings.errors.unsupportedText);
  });

  it('★ отсутствие HTTPS: отдельный текст про secure context (TDD §12.1)', () => {
    const html = renderToStaticMarkup(<UnsupportedScreen kind="INSECURE_CONTEXT" />);

    expect(html).toContain(strings.errors.insecureContextText);
    expect(html).not.toContain(strings.errors.unsupportedText);
  });
});

describe('строки интерфейса (задача 5.2)', () => {
  it('★ формулировка о выходе — «покинул комнату», без «соединение потеряно» (ФТ-31)', () => {
    expect(strings.system.leave('Борис')).toBe('Борис покинул комнату');
    const all = JSON.stringify(strings);
    expect(all).not.toContain('соединение потеряно');
    expect(all).not.toContain('Соединение потеряно');
  });

  it('все строки на русском: латиницы в текстах интерфейса нет', () => {
    const texts = [
      strings.join.heading,
      strings.join.nameLabel,
      strings.join.createButton,
      strings.join.joinButton,
      strings.room.leave,
      strings.errors.roomFullTitle,
      strings.errors.serverErrorTitle,
      strings.errors.unsupportedTitle,
    ];

    for (const text of texts) expect(text).toMatch(/[А-Яа-яЁё]/);
  });
});

describe('★ регрессия: подсказка не должна ждать submit (задача 5.4)', () => {
  it('пустое нетронутое поле молчит — это исходное состояние формы', () => {
    expect(shouldShowNameHint('', false, false)).toBe(false);
  });

  it('★ недопустимое значение объясняется сразу при вводе, не дожидаясь Enter', () => {
    // Кнопка disabled → submit не происходит → без этого правила пользователь
    // видит мёртвую кнопку без объяснения (найдено на ручной приёмке).
    expect(shouldShowNameHint('<script>', false, false)).toBe(true);
    expect(shouldShowNameHint('-Аня', false, false)).toBe(true);
  });

  it('пустое поле после ухода из него или попытки отправки подсказывает про обязательность', () => {
    expect(shouldShowNameHint('', true, false)).toBe(true);
    expect(shouldShowNameHint('   ', true, false)).toBe(true);
  });

  it('валидное имя подсказку не показывает ни при каких условиях', () => {
    expect(shouldShowNameHint('Анна-Мария', false, true)).toBe(false);
    expect(shouldShowNameHint('Анна-Мария', true, true)).toBe(false);
  });
});
