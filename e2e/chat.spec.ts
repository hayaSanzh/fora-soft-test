/**
 * E3, E4, E5 — чат и XSS-проба (задача IP 13.3, ФТ-21…25, ФТ-39, US-8).
 *
 * ★ E5 — единственный тест проекта, который проверяет XSS **в настоящем
 * браузере**. Компонентные тесты показывают, что HTML остаётся текстом в DOM; но
 * доказать, что скрипт не исполнился, может только браузер: здесь ловится
 * событие `dialog`, которого не должно быть ни одного.
 */
import { expect, test } from '@playwright/test';
import { expectInRoom, joinRoom, newRoomId, type Participant } from './helpers';

/** Отправка сообщения в чат (ФТ-21). */
async function sendMessage(participant: Participant, text: string): Promise<void> {
  await participant.page.getByPlaceholder('Сообщение').fill(text);
  await participant.page.getByRole('button', { name: 'Отправить' }).click();
}

/** Строки истории чата. */
function chatItems(participant: Participant) {
  return participant.page.locator('.chat__item');
}

test.describe('E3 чат между тремя участниками (ФТ-21, ФТ-22, US-8)', () => {
  test('★ сообщение видно всем, с именем автора и временем HH:MM', async ({ browser }) => {
    const roomId = newRoomId('chat3');
    const joined: Participant[] = [];

    try {
      for (const name of ['Аня', 'Борис', 'Вера']) {
        const participant = await joinRoom(browser, roomId, name);
        await expectInRoom(participant.page);
        joined.push(participant);
      }
      const [anya, boris, vera] = joined;
      if (!anya || !boris || !vera) throw new Error('участники не открылись');

      await sendMessage(anya, 'всем привет');

      // Сообщение у всех трёх, включая автора.
      for (const participant of joined) {
        const message = chatItems(participant).filter({ hasText: 'всем привет' });
        await expect(message).toHaveCount(1);
        await expect(message).toContainText('Аня');
        await expect(message).toContainText(/\d{2}:\d{2}/);
      }
    } finally {
      for (const participant of joined) await participant.close();
    }
  });

  test('★ порядок сообщений одинаков у всех участников (ФТ-23)', async ({ browser }) => {
    const roomId = newRoomId('order');
    const joined: Participant[] = [];

    try {
      for (const name of ['Аня', 'Борис']) {
        const participant = await joinRoom(browser, roomId, name);
        await expectInRoom(participant.page);
        joined.push(participant);
      }
      const [anya, boris] = joined;
      if (!anya || !boris) throw new Error('участники не открылись');

      // Отправка по очереди, с ожиданием доставки: порядок задаёт сервер.
      await sendMessage(anya, 'первое');
      await expect(chatItems(boris).filter({ hasText: 'первое' })).toHaveCount(1);
      await sendMessage(boris, 'второе');
      await expect(chatItems(anya).filter({ hasText: 'второе' })).toHaveCount(1);
      await sendMessage(anya, 'третье');
      await expect(chatItems(boris).filter({ hasText: 'третье' })).toHaveCount(1);

      const texts = async (participant: Participant) =>
        (await chatItems(participant).allInnerTexts())
          .map((line) => line.replace(/\s+/g, ' ').trim())
          .filter((line) => /первое|второе|третье/.test(line));

      expect(await texts(anya)).toEqual(await texts(boris));
      expect((await texts(anya)).length).toBe(3);
    } finally {
      for (const participant of joined) await participant.close();
    }
  });

  test('★ пустое сообщение отправить нельзя (ФТ-24)', async ({ browser }) => {
    const roomId = newRoomId('empty');
    const anya = await joinRoom(browser, roomId, 'Аня');

    try {
      await expectInRoom(anya.page);
      const send = anya.page.getByRole('button', { name: 'Отправить' });
      await expect(send).toBeDisabled();

      await anya.page.getByPlaceholder('Сообщение').fill('   ');
      await expect(send).toBeDisabled();
    } finally {
      await anya.close();
    }
  });
});

test.describe('E4 поздний участник видит переписку (ФТ-23, US-8)', () => {
  test('★ история и системные сообщения переигрываются при входе', async ({ browser }) => {
    const roomId = newRoomId('late');
    const joined: Participant[] = [];

    try {
      const anya = await joinRoom(browser, roomId, 'Аня');
      await expectInRoom(anya.page);
      joined.push(anya);

      const boris = await joinRoom(browser, roomId, 'Борис');
      await expectInRoom(boris.page);
      joined.push(boris);

      await sendMessage(anya, 'до прихода Веры');
      await expect(chatItems(boris).filter({ hasText: 'до прихода Веры' })).toHaveCount(1);

      // Вера входит последней и должна увидеть всё, что было до неё.
      const vera = await joinRoom(browser, roomId, 'Вера');
      await expectInRoom(vera.page);
      joined.push(vera);

      await expect(chatItems(vera).filter({ hasText: 'до прихода Веры' })).toHaveCount(1);
      await expect(chatItems(vera).filter({ hasText: 'Аня вошёл в комнату' })).toHaveCount(1);
      await expect(chatItems(vera).filter({ hasText: 'Борис вошёл в комнату' })).toHaveCount(1);
    } finally {
      for (const participant of joined) await participant.close();
    }
  });
});

test.describe('E5 ★ XSS-проба в настоящем браузере (ФТ-39)', () => {
  test('★ HTML в сообщении отображается как текст, скрипт не исполняется', async ({ browser }) => {
    const roomId = newRoomId('xss');
    const anya = await joinRoom(browser, roomId, 'Аня');
    const boris = await joinRoom(browser, roomId, 'Борис');

    // Любое сработавшее alert/confirm — провал теста.
    const dialogs: string[] = [];
    for (const participant of [anya, boris]) {
      participant.page.on('dialog', (dialog) => {
        dialogs.push(dialog.message());
        void dialog.dismiss();
      });
    }

    try {
      await expectInRoom(anya.page);
      await expectInRoom(boris.page);

      const payloads = [
        '<img src=x onerror=alert(1)>',
        '<script>alert(2)</script>',
        '<svg onload=alert(3)>',
        'javascript:alert(4)',
        '"><iframe src=javascript:alert(5)>',
      ];
      for (const payload of payloads) {
        await sendMessage(anya, payload);
        await expect(chatItems(boris).filter({ hasText: payload })).toHaveCount(1);
      }

      // ★ Ни один диалог не открылся.
      expect(dialogs).toEqual([]);

      // ★ Ни один payload не превратился в разметку.
      const chat = boris.page.locator('.chat');
      await expect(chat.locator('img')).toHaveCount(0);
      await expect(chat.locator('iframe')).toHaveCount(0);
      await expect(chat.locator('svg')).toHaveCount(0);
      // Ссылки в чате не автолинкуются (TDD §10.3).
      await expect(chat.locator('a')).toHaveCount(0);

      // Сообщения на месте — payload доставлен именно как текст.
      await expect(chatItems(boris)).toHaveCount(payloads.length + 2);
    } finally {
      await anya.close();
      await boris.close();
    }
  });

  test('★ HTML в имени участника тоже остаётся текстом', async ({ browser }) => {
    const roomId = newRoomId('xssname');
    // Имя проходит валидацию по whitelist, поэтому теги в него не попадут вовсе:
    // проверяем, что попытка ввода отклонена интерфейсом (ФТ-38).
    const attacker = await joinRoom(browser, roomId, 'Аня');

    try {
      await expectInRoom(attacker.page);
      await attacker.page.getByRole('button', { name: 'Выйти' }).click();
      await attacker.page.getByRole('button', { name: 'Вернуться' }).click();

      await attacker.page.getByLabel('Ваше имя').fill('<script>alert(1)</script>');
      await expect(attacker.page.getByRole('button', { name: 'Войти' })).toBeDisabled();
      await expect(attacker.page.getByText(/В имени допустимы/)).toBeVisible();
    } finally {
      await attacker.close();
    }
  });
});
