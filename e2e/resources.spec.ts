/**
 * Утечки ресурсов и измеримость задержки (задачи IP 14.5, 14.3; риск R7).
 *
 * ★ План относил обе проверки к ручным: 14.5 — «прочитать
 * `chrome://webrtc-internals` глазами», 14.3 — «замерить задержку в LAN».
 * Программного API у этой страницы нет, но **сами объекты доступны**, если
 * перехватить их до старта приложения: `RTCPeerConnection` и `getUserMedia`
 * обёрнуты в `addInitScript` (см. `helpers.ts`). Поэтому «не осталось живых
 * соединений и дорожек» проверяется автоматически.
 *
 * Что осталось ручным и почему — `docs/manual-verification-video-chat-room.md`:
 * аппаратный индикатор камеры недоступен из браузера, а loopback не заменяет
 * реальную сеть между машинами.
 */
import { expect, test } from '@playwright/test';
import {
  expectInRoom,
  expectIncomingVideo,
  joinRoom,
  latencyStats,
  newRoomId,
  resourceState,
  tiles,
} from './helpers';

test.describe('14.5 ★ после выхода не остаётся живых ресурсов (риск R7)', () => {
  test('★ «Выйти» закрывает соединения и останавливает дорожки', async ({ browser }) => {
    const roomId = newRoomId('leave-leak');
    const anya = await joinRoom(browser, roomId, 'Аня');
    const boris = await joinRoom(browser, roomId, 'Борис');

    try {
      await expectIncomingVideo(anya.page);

      const during = await resourceState(anya.page);
      expect(during.totalConnections).toBeGreaterThan(0);
      expect(during.totalTracks).toBeGreaterThan(0);
      expect(during.liveTracks).toBeGreaterThan(0);

      await anya.page.getByRole('button', { name: 'Выйти' }).click();
      await expect(anya.page.getByText('Вы вышли из комнаты')).toBeVisible();

      // ★ Ни одного открытого соединения и ни одной живой дорожки: иначе камера
      // продолжает работать после выхода — самая заметная утечка (риск R7).
      await expect
        .poll(async () => (await resourceState(anya.page)).openConnections, { timeout: 10_000 })
        .toBe(0);
      await expect
        .poll(async () => (await resourceState(anya.page)).liveTracks, { timeout: 10_000 })
        .toBe(0);
    } finally {
      await anya.close();
      await boris.close();
    }
  });

  test('★ уход собеседника закрывает соединение с ним, свои дорожки живы', async ({ browser }) => {
    const roomId = newRoomId('peer-leak');
    const anya = await joinRoom(browser, roomId, 'Аня');
    const boris = await joinRoom(browser, roomId, 'Борис');

    try {
      await expectIncomingVideo(anya.page);
      await boris.close();
      await expect(tiles(anya.page)).toHaveCount(1);

      const after = await resourceState(anya.page);
      // Соединение с ушедшим закрыто…
      expect(after.openConnections).toBe(0);
      // …а свои устройства продолжают работать: Аня осталась в комнате.
      expect(after.liveTracks).toBeGreaterThan(0);
    } finally {
      await anya.close();
    }
  });

  test('★ переход на другую страницу тоже освобождает устройства', async ({ browser }) => {
    const roomId = newRoomId('nav-leak');
    const anya = await joinRoom(browser, roomId, 'Аня');

    try {
      await expectInRoom(anya.page);
      await expect
        .poll(async () => (await resourceState(anya.page)).liveTracks, { timeout: 10_000 })
        .toBeGreaterThan(0);

      /*
       * ★ Размонтирование = выход (задача 9.3). Проверяется переходом внутри SPA,
       * а не перезагрузкой: при перезагрузке контекст исполнения уничтожается
       * целиком, и тест был бы бессмысленным — дорожки «исчезли» бы вместе со
       * страницей, ничего не доказывая о нашем teardown.
       */
      await anya.page.getByRole('button', { name: 'Выйти' }).click();
      await anya.page.getByRole('button', { name: 'Вернуться' }).click();

      await expect
        .poll(async () => (await resourceState(anya.page)).liveTracks, { timeout: 10_000 })
        .toBe(0);
    } finally {
      await anya.close();
    }
  });

  test('★ повторный вход не накапливает соединения', async ({ browser }) => {
    const roomId = newRoomId('rejoin');
    const anya = await joinRoom(browser, roomId, 'Аня');
    const boris = await joinRoom(browser, roomId, 'Борис');

    try {
      await expectIncomingVideo(anya.page);
      const first = await resourceState(anya.page);

      // Выход и вход заново тем же участником.
      await anya.page.getByRole('button', { name: 'Выйти' }).click();
      await anya.page.getByRole('button', { name: 'Вернуться' }).click();
      await anya.page.getByLabel('Ваше имя').fill('Аня');
      await anya.page.getByRole('button', { name: 'Войти' }).click();
      await expectIncomingVideo(anya.page);

      const second = await resourceState(anya.page);
      // Всего соединений стало больше (создано новое), но открытых — ровно одно
      // на одного собеседника: старые закрыты, а не забыты.
      expect(second.totalConnections).toBeGreaterThan(first.totalConnections);
      expect(second.openConnections).toBe(1);
    } finally {
      await anya.close();
      await boris.close();
    }
  });
});

test.describe('14.3 измеримость задержки', () => {
  test('★ поля задержки в getStats() заполняются — ручной LAN-замер выполним', async ({
    browser,
  }) => {
    const roomId = newRoomId('rtt');
    const anya = await joinRoom(browser, roomId, 'Аня');
    const boris = await joinRoom(browser, roomId, 'Борис');

    try {
      await expectIncomingVideo(anya.page);

      const stats = await expect
        .poll(async () => (await latencyStats(anya.page)).roundTripMs, { timeout: 20_000 })
        .not.toBeNull()
        .then(() => latencyStats(anya.page));

      /*
       * ★ Это НЕ проверка требования «≤ 500 мс»: на loopback нет ни сети, ни
       * разных машин. Проверяется измеримость — что поля заполнены и значения
       * осмысленны. Само требование проверяется вручную между физическими
       * машинами (docs/manual-verification-video-chat-room.md, п. 3).
       */
      expect(stats.roundTripMs).not.toBeNull();
      expect(stats.roundTripMs ?? Infinity).toBeLessThan(500);
      expect(stats.videoJitterBufferMs).not.toBeNull();
    } finally {
      await anya.close();
      await boris.close();
    }
  });
});
