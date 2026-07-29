/**
 * E1, E2, E13 — звонок, лимит участников, раскладка (задача IP 13.2, 13.6).
 *
 * Это первые тесты проекта, которые проверяют **настоящий** WebRTC: до них mesh
 * жил на моке `RTCPeerConnection` (группа 8) и на sequence-тестах сигналинга
 * (группа 9). Здесь Chromium с фейковой камерой реально собирает ICE-кандидаты,
 * обменивается SDP и декодирует видео.
 */
import { expect, test } from '@playwright/test';
import {
  expectInRoom,
  expectIncomingVideo,
  inboundStats,
  joinRoom,
  newRoomId,
  openRoomPage,
  tiles,
  videos,
  type Participant,
} from './helpers';

test.describe('E1 звонок двух участников (ФТ-10, US-6)', () => {
  test('★ у каждого две плитки и входящее видео действительно декодируется', async ({
    browser,
  }) => {
    const roomId = newRoomId('call');
    const anya = await joinRoom(browser, roomId, 'Аня');
    const boris = await joinRoom(browser, roomId, 'Борис');

    try {
      await expectInRoom(anya.page);
      await expectInRoom(boris.page);

      // Обе плитки у обоих: своя и собеседника (ФТ-10, ФТ-12).
      await expect(tiles(anya.page)).toHaveCount(2);
      await expect(tiles(boris.page)).toHaveCount(2);

      // ★ Главное: не «плитка отрисовалась», а медиа идёт. Заглушка, чёрный
      // кадр и остановленная дорожка выглядят в DOM одинаково.
      await expectIncomingVideo(anya.page);
      await expectIncomingVideo(boris.page);

      const stats = await inboundStats(anya.page);
      expect(stats.audioBytesReceived).toBeGreaterThan(0);
      expect(stats.videoBytesReceived).toBeGreaterThan(0);
    } finally {
      await anya.close();
      await boris.close();
    }
  });

  test('★ элементы <video> получили поток и играют', async ({ browser }) => {
    const roomId = newRoomId('play');
    const anya = await joinRoom(browser, roomId, 'Аня');
    const boris = await joinRoom(browser, roomId, 'Борис');

    try {
      await expectIncomingVideo(anya.page);

      const state = await videos(anya.page)
        .nth(1)
        .evaluate((node) => {
          const video = node as HTMLVideoElement;
          return {
            hasStream: video.srcObject !== null,
            readyState: video.readyState,
            width: video.videoWidth,
            paused: video.paused,
            muted: video.muted,
          };
        });

      expect(state.hasStream).toBe(true);
      expect(state.readyState).toBeGreaterThan(0);
      expect(state.width).toBeGreaterThan(0);
      expect(state.paused).toBe(false);
      // ★ Плитка пира НЕ заглушена — иначе видео есть, а звука нет (ФТ-19).
      expect(state.muted).toBe(false);
    } finally {
      await anya.close();
      await boris.close();
    }
  });

  test('★ своя плитка заглушена: иначе гарантированное эхо (ФТ-18)', async ({ browser }) => {
    const roomId = newRoomId('echo');
    const anya = await joinRoom(browser, roomId, 'Аня');

    try {
      await expectInRoom(anya.page);
      await expect(videos(anya.page).first()).toHaveJSProperty('muted', true);
    } finally {
      await anya.close();
    }
  });
});

test.describe('E2 лимит участников (ФТ-8, US-5)', () => {
  test('★ пятый получает «Комната заполнена», кнопка повтора рабочая', async ({ browser }) => {
    const roomId = newRoomId('full');
    const names = ['Аня', 'Борис', 'Вера', 'Глеб'];
    const joined: Participant[] = [];

    try {
      for (const name of names) {
        const participant = await joinRoom(browser, roomId, name);
        await expectInRoom(participant.page);
        joined.push(participant);
      }

      // Пятый: сервер отказывает по лимиту.
      const fifth = await openRoomPage(browser, roomId, { grantMedia: true });
      joined.push(fifth);
      await fifth.page.getByLabel('Ваше имя').fill('Дима');
      await fifth.page.getByRole('button', { name: 'Войти' }).click();

      await expect(fifth.page.getByText('Комната заполнена')).toBeVisible();
      const retry = fifth.page.getByRole('button', { name: 'Повторить вход' });
      await expect(retry).toBeVisible();

      // ★ Повтор при по-прежнему полной комнате возвращает тот же экран,
      // а не белую страницу и не тупик.
      await retry.click();
      await expect(fifth.page.getByText('Комната заполнена')).toBeVisible();

      // Освобождается место — и тот же повтор срабатывает, не спрашивая имя.
      const leaving = joined[0];
      if (!leaving) throw new Error('нет участника для выхода');
      await leaving.page.getByRole('button', { name: 'Выйти' }).click();
      await expect(leaving.page.getByText('Вы вышли из комнаты')).toBeVisible();

      await fifth.page.getByRole('button', { name: 'Повторить вход' }).click();
      await expectInRoom(fifth.page);
      await expect(fifth.page.getByText('Дима', { exact: false }).first()).toBeVisible();
    } finally {
      for (const participant of joined) await participant.close();
    }
  });
});

test.describe('E13 полная сетка (ФТ-11)', () => {
  test('★ четверо участников — раскладка 2×2 при ширине 1024px', async ({ browser }) => {
    const roomId = newRoomId('grid');
    const joined: Participant[] = [];

    try {
      for (const name of ['Аня', 'Борис', 'Вера', 'Глеб']) {
        const participant = await joinRoom(browser, roomId, name);
        await participant.page.setViewportSize({ width: 1024, height: 800 });
        await expectInRoom(participant.page);
        joined.push(participant);
      }

      const first = joined[0];
      if (!first) throw new Error('нет участников');
      await expect(tiles(first.page)).toHaveCount(4);
      await expect(first.page.locator('.grid--quad')).toBeVisible();

      // ★ Сетка именно 2×2: две плитки в ряду, а не четыре в строку и не одна
      // растянутая. Проверяется по фактическим координатам, а не по классу.
      const boxes = await tiles(first.page).evaluateAll((nodes) =>
        nodes.map((node) => {
          const rect = node.getBoundingClientRect();
          return { left: Math.round(rect.left), top: Math.round(rect.top) };
        }),
      );
      expect(new Set(boxes.map((box) => box.left)).size).toBe(2);
      expect(new Set(boxes.map((box) => box.top)).size).toBe(2);

      // ★ Горизонтальной прокрутки нет (PRD §5: десктоп от 1024px).
      const overflow = await first.page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    } finally {
      for (const participant of joined) await participant.close();
    }
  });
});
