/**
 * Кросс-браузерный прогон основного сценария (задача IP 14.6, PRD §7).
 *
 * План относил эту проверку к ручным целиком, но сам же отмечал: «Playwright
 * покрывает Chromium/Firefox; Edge — вручную». Поэтому Firefox автоматизирован,
 * а вручную остаётся только Edge (см. `docs/manual-verification-video-chat-room.md`).
 *
 * ★ Здесь прогоняется **основной сценарий**, а не весь набор E1–E13: цель —
 * поймать различия движков в WebRTC, а не перепроверить логику приложения
 * второй раз. Различия, из-за которых такой прогон и нужен:
 *
 * - Firefox иначе ведёт себя с `addTransceiver` и порядком m-строк в SDP;
 * - `replaceTrack(null)` в Firefox исторически вёл себя не так, как в Chromium;
 * - политика автозапуска и `muted` реализованы разными подсистемами.
 *
 * Тесты помечены `@cross-browser` и идут в **обоих** project'ах: если сценарий
 * падает только в Firefox — дело в движке, а если в обоих — в приложении.
 */
import { expect, test } from '@playwright/test';
import {
  expectAudioKeepsFlowing,
  expectInRoom,
  expectIncomingVideo,
  joinRoom,
  newRoomId,
  resourceState,
  tiles,
  videos,
} from './helpers';

test.describe('14.6 основной сценарий в другом браузере', () => {
  test('★ звонок вдвоём: видео идёт в обе стороны @cross-browser', async ({ browser }) => {
    const roomId = newRoomId('xb-call');
    const anya = await joinRoom(browser, roomId, 'Аня');
    const boris = await joinRoom(browser, roomId, 'Борис');

    try {
      await expectInRoom(anya.page);
      await expectInRoom(boris.page);

      await expect(tiles(anya.page)).toHaveCount(2);
      await expect(tiles(boris.page)).toHaveCount(2);

      // Медиа идёт в обе стороны, а не «плитка появилась».
      await expectIncomingVideo(anya.page);
      await expectIncomingVideo(boris.page);

      // ★ Своя плитка заглушена, плитка пира — нет. Разные движки реализуют
      // `muted` по-разному, и ошибка здесь означает либо эхо, либо тишину.
      await expect(videos(anya.page).first()).toHaveJSProperty('muted', true);
      await expect(videos(anya.page).nth(1)).toHaveJSProperty('muted', false);
    } finally {
      await anya.close();
      await boris.close();
    }
  });

  test('★ выключение камеры: заглушка есть, звук идёт @cross-browser', async ({ browser }) => {
    const roomId = newRoomId('xb-cam');
    const anya = await joinRoom(browser, roomId, 'Аня');
    const boris = await joinRoom(browser, roomId, 'Борис');

    try {
      await expectIncomingVideo(boris.page);

      await anya.page.getByRole('button', { name: 'Выключить камеру' }).click();

      const anyaTile = tiles(boris.page).filter({ hasText: 'Аня' });
      await expect(anyaTile.locator('.tile__placeholder')).toHaveCount(1);
      await expect(anyaTile.locator('video')).toHaveCount(1);

      // ★ Ключевой инвариант проекта в другом движке: `replaceTrack(null)` не
      // должен уносить с собой звук (ФТ-19, риск R5).
      await expectAudioKeepsFlowing(boris.page);

      // И камера возвращается без пересоздания соединения (риск R4).
      await anya.page.getByRole('button', { name: 'Включить камеру' }).click();
      await expect(anyaTile.locator('.tile__placeholder')).toHaveCount(0);
    } finally {
      await anya.close();
      await boris.close();
    }
  });

  test('★ чат и системные сообщения @cross-browser', async ({ browser }) => {
    const roomId = newRoomId('xb-chat');
    const anya = await joinRoom(browser, roomId, 'Аня');
    const boris = await joinRoom(browser, roomId, 'Борис');

    try {
      await expectInRoom(anya.page);
      await expectInRoom(boris.page);

      await anya.page.getByPlaceholder('Сообщение').fill('привет из другого браузера');
      await anya.page.getByRole('button', { name: 'Отправить' }).click();

      const message = boris.page.locator('.chat__item').filter({ hasText: 'привет из другого' });
      await expect(message).toHaveCount(1);
      await expect(message).toContainText('Аня');
      await expect(message).toContainText(/\d{2}:\d{2}/);

      // XSS-проба и здесь: экранирование делает React, но проверить стоит в оба
      // движка — цена ошибки слишком велика (ФТ-39).
      await anya.page.getByPlaceholder('Сообщение').fill('<img src=x onerror=alert(1)>');
      await anya.page.getByRole('button', { name: 'Отправить' }).click();
      await expect(boris.page.locator('.chat img')).toHaveCount(0);
    } finally {
      await anya.close();
      await boris.close();
    }
  });

  test('★ выход освобождает устройства @cross-browser', async ({ browser }) => {
    const roomId = newRoomId('xb-leak');
    const anya = await joinRoom(browser, roomId, 'Аня');

    try {
      await expectInRoom(anya.page);
      await anya.page.getByRole('button', { name: 'Выйти' }).click();
      await expect(anya.page.getByText('Вы вышли из комнаты')).toBeVisible();

      await expect
        .poll(async () => (await resourceState(anya.page)).liveTracks, { timeout: 10_000 })
        .toBe(0);
    } finally {
      await anya.close();
    }
  });
});
