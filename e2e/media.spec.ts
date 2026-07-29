/**
 * E6, E7 — тумблеры устройств (задача IP 13.4, ФТ-16, ФТ-18, ФТ-19, риск R5).
 *
 * ★ **E6 — самый ценный тест всего проекта.** Он ловит регрессию, которая
 * выглядит совершенно безобидно в коде и не ловится ничем, кроме настоящего
 * WebRTC:
 *
 * ```tsx
 * {hasVideo && <video ref={...} />}   // ← вместе с картинкой умирает ЗВУК пира
 * ```
 *
 * Компонентный тест 12.2 проверяет, что узел `<video>` не размонтируется. Здесь
 * проверяется следствие: при выключенной камере собеседника **аудио продолжает
 * идти** — `bytesReceived` по audio растёт между двумя замерами.
 *
 * Именно «растёт», а не «больше нуля»: после остановки дорожки счётчик остаётся
 * на прежнем значении, и проверка «> 0» прошла бы на мёртвом соединении.
 */
import { expect, test } from '@playwright/test';
import {
  expectAudioKeepsFlowing,
  expectInRoom,
  expectIncomingVideo,
  inboundStats,
  joinRoom,
  newRoomId,
  tiles,
} from './helpers';

test.describe('E6 ★ выключение камеры не останавливает звук (ФТ-18, ФТ-19, R5)', () => {
  test('★ у собеседника появилась заглушка, а аудио продолжает идти', async ({ browser }) => {
    const roomId = newRoomId('camoff');
    const anya = await joinRoom(browser, roomId, 'Аня');
    const boris = await joinRoom(browser, roomId, 'Борис');

    try {
      await expectInRoom(anya.page);
      await expectInRoom(boris.page);
      await expectIncomingVideo(boris.page);

      const anyaTileForBoris = tiles(boris.page).filter({ hasText: 'Аня' });
      await expect(anyaTileForBoris.locator('.tile__placeholder')).toHaveCount(0);

      // Аня выключает камеру (ФТ-17).
      await anya.page.getByRole('button', { name: 'Выключить камеру' }).click();
      await expect(anya.page.getByRole('button', { name: 'Включить камеру' })).toBeVisible();

      // ★ У Бориса на плитке Ани — заглушка-силуэт с именем (ФТ-18).
      await expect(anyaTileForBoris.locator('.tile__placeholder')).toHaveCount(1);
      await expect(anyaTileForBoris.locator('.tile__placeholder')).toContainText('Аня');

      // ★ И при этом элемент <video> НЕ исчез из DOM (риск R5).
      await expect(anyaTileForBoris.locator('video')).toHaveCount(1);

      // ★ Главное утверждение: звук Ани продолжает приходить Борису.
      await expectAudioKeepsFlowing(boris.page);
    } finally {
      await anya.close();
      await boris.close();
    }
  });

  test('★ включение камеры обратно возвращает видео (ренегоциация работает)', async ({
    browser,
  }) => {
    const roomId = newRoomId('camback');
    const anya = await joinRoom(browser, roomId, 'Аня');
    const boris = await joinRoom(browser, roomId, 'Борис');

    try {
      await expectIncomingVideo(boris.page);

      await anya.page.getByRole('button', { name: 'Выключить камеру' }).click();
      const anyaTileForBoris = tiles(boris.page).filter({ hasText: 'Аня' });
      await expect(anyaTileForBoris.locator('.tile__placeholder')).toHaveCount(1);

      const framesWhileOff = (await inboundStats(boris.page)).videoFramesDecoded;

      await anya.page.getByRole('button', { name: 'Включить камеру' }).click();

      // Заглушка ушла…
      await expect(anyaTileForBoris.locator('.tile__placeholder')).toHaveCount(0);
      // …и кадры снова декодируются: `replaceTrack` вернул дорожку без пересоздания
      // соединения (TDD §4.4, риск R4).
      await expect
        .poll(async () => (await inboundStats(boris.page)).videoFramesDecoded, {
          message: 'после включения камеры кадры не пошли',
          timeout: 20_000,
        })
        .toBeGreaterThan(framesWhileOff);
    } finally {
      await anya.close();
      await boris.close();
    }
  });

  test('★ соединение не пересоздаётся на тумблер камеры (риск R4)', async ({ browser }) => {
    const roomId = newRoomId('nore');
    const anya = await joinRoom(browser, roomId, 'Аня');
    const boris = await joinRoom(browser, roomId, 'Борис');

    try {
      await expectIncomingVideo(boris.page);
      const before = await boris.page.evaluate(
        () => (window as unknown as { __pcs?: unknown[] }).__pcs?.length ?? 0,
      );

      for (let i = 0; i < 3; i += 1) {
        await anya.page.getByRole('button', { name: 'Выключить камеру' }).click();
        await anya.page.getByRole('button', { name: 'Включить камеру' }).click();
      }

      const after = await boris.page.evaluate(
        () => (window as unknown as { __pcs?: unknown[] }).__pcs?.length ?? 0,
      );

      // ★ Ни одного нового RTCPeerConnection: дорожка подменяется на месте.
      expect(after).toBe(before);
      // И соединение по-прежнему живое.
      await expectAudioKeepsFlowing(boris.page);
    } finally {
      await anya.close();
      await boris.close();
    }
  });
});

test.describe('E7 выключение микрофона (ФТ-16)', () => {
  test('★ у собеседника появилась иконка перечёркнутого микрофона', async ({ browser }) => {
    const roomId = newRoomId('micoff');
    const anya = await joinRoom(browser, roomId, 'Аня');
    const boris = await joinRoom(browser, roomId, 'Борис');

    try {
      await expectInRoom(anya.page);
      await expectInRoom(boris.page);
      await expectIncomingVideo(boris.page);

      const anyaTileForBoris = tiles(boris.page).filter({ hasText: 'Аня' });
      await expect(anyaTileForBoris.locator('.tile__mic')).toHaveCount(0);

      await anya.page.getByRole('button', { name: 'Выключить микрофон' }).click();

      // Метка у собеседника — из `media:state`, а не из WebRTC-событий (ФТ-16).
      await expect(anyaTileForBoris.locator('.tile__mic')).toHaveCount(1);
      // И в списке участников (ФТ-26).
      await expect(
        boris.page.locator('.participants__item').filter({ hasText: 'Аня' }),
      ).toContainText('🎤̶');

      // ★ Видео при этом продолжает идти: тумблеры независимы (ФТ-15…18).
      const frames = (await inboundStats(boris.page)).videoFramesDecoded;
      await expect
        .poll(async () => (await inboundStats(boris.page)).videoFramesDecoded, { timeout: 20_000 })
        .toBeGreaterThan(frames);

      await anya.page.getByRole('button', { name: 'Включить микрофон' }).click();
      await expect(anyaTileForBoris.locator('.tile__mic')).toHaveCount(0);
    } finally {
      await anya.close();
      await boris.close();
    }
  });

  test('★ выключенный микрофон не останавливает дорожку: звук возвращается сразу', async ({
    browser,
  }) => {
    const roomId = newRoomId('micback');
    const anya = await joinRoom(browser, roomId, 'Аня');
    const boris = await joinRoom(browser, roomId, 'Борис');

    try {
      await expectIncomingVideo(boris.page);

      await anya.page.getByRole('button', { name: 'Выключить микрофон' }).click();
      await anya.page.getByRole('button', { name: 'Включить микрофон' }).click();

      // ★ Микрофон выключается через `track.enabled`, а не остановкой дорожки:
      // остановленную пришлось бы получать заново через getUserMedia и
      // ренегоциировать (TDD §4.4). Признак — звук идёт сразу после включения.
      await expectAudioKeepsFlowing(boris.page);
    } finally {
      await anya.close();
      await boris.close();
    }
  });
});
