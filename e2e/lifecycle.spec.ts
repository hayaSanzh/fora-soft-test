/**
 * E8, E9, E10 — уход участника, уничтожение истории, копирование ссылки
 * (задача IP 13.5, ФТ-3, ФТ-9, ФТ-25, ФТ-28, US-3, US-10).
 *
 * ★ E9 проверяет требование, которое нельзя проверить изнутри одной страницы:
 * история чата живёт **только пока в комнате есть люди** (ФТ-9). После выхода
 * последнего участника сервер удаляет комнату вместе с перепиской — и это
 * видно только повторным входом по тому же адресу.
 */
import { expect, test } from '@playwright/test';
import { expectInRoom, joinRoom, newRoomId, tiles, type Participant } from './helpers';

async function sendMessage(participant: Participant, text: string): Promise<void> {
  await participant.page.getByPlaceholder('Сообщение').fill(text);
  await participant.page.getByRole('button', { name: 'Отправить' }).click();
}

test.describe('E8 закрытие вкладки (ФТ-25, ФТ-31, US-10, US-11)', () => {
  test('★ плитка исчезла и появилось системное сообщение о выходе', async ({ browser }) => {
    const roomId = newRoomId('close');
    const anya = await joinRoom(browser, roomId, 'Аня');
    const boris = await joinRoom(browser, roomId, 'Борис');

    try {
      await expectInRoom(anya.page);
      await expectInRoom(boris.page);
      await expect(tiles(anya.page)).toHaveCount(2);

      // Борис просто закрывает вкладку — никакого «выхода» он не нажимал.
      await boris.close();

      await expect(tiles(anya.page)).toHaveCount(1);
      await expect(anya.page.locator('.participants__heading')).toContainText('(1)');

      // ★ Формулировка «покинул комнату», а не «соединение потеряно» (ФТ-31):
      // сервер не отличает закрытие вкладки от обрыва канала.
      await expect(
        anya.page.locator('.chat__item').filter({ hasText: 'Борис покинул комнату' }),
      ).toHaveCount(1);
      await expect(anya.page.getByText('соединение потеряно')).toHaveCount(0);
    } finally {
      await anya.close();
    }
  });

  test('★ осознанный выход даёт тот же результат у остальных (ФТ-27)', async ({ browser }) => {
    const roomId = newRoomId('leave');
    const anya = await joinRoom(browser, roomId, 'Аня');
    const boris = await joinRoom(browser, roomId, 'Борис');

    try {
      await expectInRoom(anya.page);
      await expectInRoom(boris.page);

      await boris.page.getByRole('button', { name: 'Выйти' }).click();
      await expect(boris.page.getByText('Вы вышли из комнаты')).toBeVisible();

      await expect(tiles(anya.page)).toHaveCount(1);
      await expect(
        anya.page.locator('.chat__item').filter({ hasText: 'Борис покинул комнату' }),
      ).toHaveCount(1);
    } finally {
      await anya.close();
      await boris.close();
    }
  });
});

test.describe('E9 ★ история уничтожается вместе с комнатой (ФТ-9)', () => {
  test('★ после выхода последнего участника переписка не восстанавливается', async ({
    browser,
  }) => {
    const roomId = newRoomId('purge');
    const anya = await joinRoom(browser, roomId, 'Аня');
    const boris = await joinRoom(browser, roomId, 'Борис');

    try {
      await expectInRoom(anya.page);
      await expectInRoom(boris.page);

      await sendMessage(anya, 'это сообщение не должно сохраниться');
      await expect(
        boris.page.locator('.chat__item').filter({ hasText: 'не должно сохраниться' }),
      ).toHaveCount(1);

      // Комната пустеет: выходят оба.
      await boris.page.getByRole('button', { name: 'Выйти' }).click();
      await expect(boris.page.getByText('Вы вышли из комнаты')).toBeVisible();
      await anya.page.getByRole('button', { name: 'Выйти' }).click();
      await expect(anya.page.getByText('Вы вышли из комнаты')).toBeVisible();

      // Повторный вход по тому же адресу: имя спрашивают заново (ФТ-28).
      await anya.page.getByRole('button', { name: 'Вернуться' }).click();
      await anya.page.getByLabel('Ваше имя').fill('Аня');
      await anya.page.getByRole('button', { name: 'Войти' }).click();
      await expectInRoom(anya.page);

      // ★ История пуста: осталось только сообщение о собственном входе.
      await expect(
        anya.page.locator('.chat__item').filter({ hasText: 'не должно сохраниться' }),
      ).toHaveCount(0);
      await expect(anya.page.locator('.chat__item')).toHaveCount(1);
      await expect(anya.page.locator('.chat__item')).toContainText('Аня вошёл в комнату');
    } finally {
      await anya.close();
      await boris.close();
    }
  });
});

test.describe('E10 копирование ссылки-приглашения (ФТ-3, US-3)', () => {
  test('★ в буфере оказался адрес комнаты, показано подтверждение', async ({ browser }) => {
    const roomId = newRoomId('copy');
    const anya = await joinRoom(browser, roomId, 'Аня');

    try {
      await expectInRoom(anya.page);
      await anya.page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

      await anya.page.getByRole('button', { name: 'Скопировать ссылку' }).click();

      // Видимое подтверждение обязательно: иначе пользователь отправит пустоту.
      await expect(anya.page.getByText('Ссылка скопирована')).toBeVisible();

      const clipboard = await anya.page.evaluate(() => navigator.clipboard.readText());
      expect(clipboard).toBe(anya.page.url());
      // ★ В ссылке нет имени участника: ею делятся с другими.
      expect(clipboard).not.toContain('Аня');
    } finally {
      await anya.close();
    }
  });

  test('★ скопированная ссылка действительно ведёт в ту же комнату', async ({ browser }) => {
    const roomId = newRoomId('invite');
    const anya = await joinRoom(browser, roomId, 'Аня');

    try {
      await expectInRoom(anya.page);
      await anya.page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
      await anya.page.getByRole('button', { name: 'Скопировать ссылку' }).click();
      const link = await anya.page.evaluate(() => navigator.clipboard.readText());

      // Второй участник открывает именно эту ссылку.
      const context = await browser.newContext();
      await context.grantPermissions(['camera', 'microphone']);
      const page = await context.newPage();
      await page.goto(link);
      await page.getByLabel('Ваше имя').fill('Борис');
      await page.getByRole('button', { name: 'Войти' }).click();

      await expect(page.getByRole('group', { name: 'Управление звонком' })).toBeVisible();
      await expect(tiles(anya.page)).toHaveCount(2);
      await context.close();
    } finally {
      await anya.close();
    }
  });
});
