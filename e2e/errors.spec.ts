/**
 * E11, E12 — отказ в доступе к устройствам и недоступный сервер
 * (задача IP 13.6, ФТ-33, ФТ-35, US-12, US-13).
 *
 * ★ E11 идёт в отдельном project'е `chromium-no-media`: в основном разрешения
 * подтверждаются флагом `--use-fake-ui-for-media-stream`, и недоступность
 * устройств там не воспроизводится вовсе.
 *
 * ★ Проверяется **инвариант**, а не конкретный текст баннера: проба показала,
 * что headless-Chromium без фейкового UI отдаёт `NotSupportedError`, а не
 * `NotAllowedError` — то есть подсистема захвата недоступна, а не пользователь
 * отказал. Для приложения это один и тот же класс ситуации (ФТ-33): участник
 * входит в комнату без устройств. Конкретные коды разобраны unit-тестами
 * `toMediaErrorKind`, а настоящий отказ пользователя — ручной проверкой.
 */
import { expect, test } from '@playwright/test';
import { expectInRoom, newRoomId, openRoomPage, tiles } from './helpers';

/**
 * Тексты баннеров устройств (`strings.errors.media*`). Продублированы намеренно:
 * E2E не должен зависеть от внутренних модулей приложения — он проверяет то, что
 * видит пользователь.
 */
const MEDIA_BANNERS = [
  'Нет доступа к камере или микрофону',
  'Нет доступа к камере.',
  'Нет доступа к микрофону.',
  'Камера не найдена',
  'Микрофон не найден',
  'Камера или микрофон не найдены',
  'Устройство занято другим приложением',
  'Камера не поддерживает запрошенное качество',
  'Устройство отключено',
  'Не удалось получить доступ к камере или микрофону',
];

test.describe('E11 отказ в доступе к камере и микрофону (ФТ-33, US-12)', () => {
  test('★ вход состоялся, показан баннер, приложение живо @denied-media', async ({ browser }) => {
    const roomId = newRoomId('denied');
    // Разрешения НЕ выдаются: браузер откажет по-настоящему.
    const anya = await openRoomPage(browser, roomId);

    try {
      await anya.page.getByLabel('Ваше имя').fill('Аня');
      await anya.page.getByRole('button', { name: 'Войти' }).click();

      // ★ Пользователь В КОМНАТЕ, а не на экране ошибки: отказ медиа не
      // терминален (TDD §8.3).
      await expectInRoom(anya.page);

      // Баннер объясняет, что произошло — одним из текстов §8.1, а не заглушкой
      // «что-то пошло не так».
      const banner = anya.page.locator('.banner--error');
      await expect(banner).toBeVisible();
      const bannerText = await banner.innerText();
      expect(MEDIA_BANNERS.some((text) => bannerText.includes(text))).toBe(true);

      // Своя плитка на месте, с заглушкой вместо видео.
      await expect(tiles(anya.page)).toHaveCount(1);
      await expect(anya.page.locator('.tile__placeholder')).toHaveCount(1);

      // Чат работает: без устройств участие в комнате не теряет смысла.
      await anya.page.getByPlaceholder('Сообщение').fill('я без камеры');
      await anya.page.getByRole('button', { name: 'Отправить' }).click();
      await expect(
        anya.page.locator('.chat__item').filter({ hasText: 'я без камеры' }),
      ).toHaveCount(1);

      // Баннер закрывается и сам не возвращается (задача 11.4).
      await anya.page.getByRole('button', { name: 'Скрыть' }).click();
      await expect(anya.page.locator('.banner--error')).toHaveCount(0);
    } finally {
      await anya.close();
    }
  });

  test('★ участник без устройств виден остальным и видит их @denied-media', async ({ browser }) => {
    const roomId = newRoomId('mixed');
    const anya = await openRoomPage(browser, roomId);
    // Второму разрешения выдаются точечно — устройства у него есть.
    const boris = await openRoomPage(browser, roomId, { grantMedia: true });

    try {
      await anya.page.getByLabel('Ваше имя').fill('Аня');
      await anya.page.getByRole('button', { name: 'Войти' }).click();
      await expectInRoom(anya.page);

      await boris.page.getByLabel('Ваше имя').fill('Борис');
      await boris.page.getByRole('button', { name: 'Войти' }).click();
      await expectInRoom(boris.page);

      // Обоих видно в списке и в сетке.
      await expect(tiles(anya.page)).toHaveCount(2);
      await expect(tiles(boris.page)).toHaveCount(2);

      // ★ У Бориса плитка Ани — с заглушкой: SDP валиден и без дорожек
      // (TDD §4.5, нюанс 1 — трансиверы созданы заранее).
      const anyaTile = tiles(boris.page).filter({ hasText: 'Аня' });
      await expect(anyaTile.locator('.tile__placeholder')).toHaveCount(1);
      await expect(anyaTile.locator('video')).toHaveCount(1);

      // Чат между ними работает в обе стороны.
      await boris.page.getByPlaceholder('Сообщение').fill('слышишь меня?');
      await boris.page.getByRole('button', { name: 'Отправить' }).click();
      await expect(
        anya.page.locator('.chat__item').filter({ hasText: 'слышишь меня?' }),
      ).toHaveCount(1);
    } finally {
      await anya.close();
      await boris.close();
    }
  });
});

test.describe('E12 сервер недоступен (ФТ-35, US-13)', () => {
  test('★ экран ошибки сервера, а не белая страница', async ({ browser }) => {
    const roomId = newRoomId('offline');
    const anya = await openRoomPage(browser, roomId, { grantMedia: true });

    try {
      await anya.page.getByLabel('Ваше имя').fill('Аня');

      /*
       * ★ Сеть отключается уже после загрузки страницы, поэтому воспроизводится
       * ровно тот случай, который описывает ФТ-35: приложение работает, а
       * сигналинг недоступен.
       *
       * Именно так, а не остановкой сервера: сервер один на весь прогон, и его
       * остановка сломала бы остальные тесты. Со стороны клиента разницы нет —
       * WebSocket не устанавливается в обоих случаях.
       */
      await anya.page.context().setOffline(true);
      await anya.page.getByRole('button', { name: 'Войти' }).click();

      await expect(anya.page.getByText('Нет связи с сервером')).toBeVisible({ timeout: 30_000 });
      await expect(anya.page.getByRole('button', { name: 'Повторить' })).toBeVisible();

      // ★ Формулировка про потерянное соединение не используется (ФТ-31).
      await expect(anya.page.getByText('соединение потеряно')).toHaveCount(0);

      // Сеть вернулась — тот же «Повторить» доводит до комнаты.
      await anya.page.context().setOffline(false);
      await anya.page.getByRole('button', { name: 'Повторить' }).click();
      await expectInRoom(anya.page);
    } finally {
      await anya.close();
    }
  });
});

test.describe('E12 крайние случаи маршрутов (ФТ-5, TDD §5.3)', () => {
  test('★ битая ссылка объясняет причину и ведёт на создание комнаты', async ({ page }) => {
    // Короче минимума ROOM_ID_PATTERN — единственная причина попасть сюда.
    await page.goto('/ab');

    await expect(page.getByText('Некорректная ссылка')).toBeVisible();
    await page.getByRole('link', { name: 'Создать комнату' }).click();
    await expect(page.getByRole('button', { name: 'Создать комнату' })).toBeVisible();
  });

  test('★ вход по угаданному адресу создаёт комнату, а не ошибку (ФТ-5, ФТ-6)', async ({
    page,
  }) => {
    await page.goto('/SomeGuessedRoom');

    // Состояния «комната не найдена» не существует: любой валидный id валиден.
    await expect(page.getByText('Вас пригласили в комнату')).toBeVisible();
  });

  test('★ прямой переход по ссылке работает: SPA-fallback на сервере', async ({ page }) => {
    const response = await page.goto(`/${newRoomId('spa')}`);

    expect(response?.status()).toBe(200);
    await expect(page.getByLabel('Ваше имя')).toBeVisible();
  });
});
