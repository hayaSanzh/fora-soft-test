import { defineConfig, devices } from '@playwright/test';

/**
 * Конфигурация E2E (задача IP 13.1, TDD §11.4).
 *
 * Запуск Chromium с фейковыми устройствами — единственный способ прогнать
 * настоящий WebRTC в CI без камеры и микрофона.
 *
 * ★ Три решения, каждое из которых защищает от ложных результатов:
 *
 * 1. **Свой порт 3101 и никакого `reuseExistingServer`.** Тесты обязаны идти
 *    против того артефакта, который только что собран. Переиспользование уже
 *    запущенного сервера один раз уже привело к разбору «дефекта», которого не
 *    было: проверялся устаревший бандл (приёмка группы 7).
 * 2. **`workers: 1`.** Сервер держит состояние комнат в памяти, а тесты
 *    проверяют лимит участников и системные сообщения о входах/выходах.
 *    Параллельные воркеры создавали бы гонки не в коде, а в тестах.
 * 3. **Два project'а.** В основном `--use-fake-ui-for-media-stream` подтверждает
 *    любой запрос разрешений, поэтому недоступность устройств там не
 *    воспроизводится вовсе. Для E11 есть отдельный project без этого флага.
 *
 * ★ Важная поправка по факту (проверено пробой в этой сборке Chromium): без
 * фейкового UI headless-shell отдаёт **`NotSupportedError`**, а не
 * `NotAllowedError` — подсистема захвата недоступна, а не пользователь отказал.
 * Поэтому E11 проверяет инвариант «медиа недоступно → участник всё равно в
 * комнате, видит баннер и пишет в чат», не привязываясь к конкретному тексту.
 * Ветка настоящего `NotAllowedError` покрыта unit-тестами `toMediaErrorKind` и
 * ручной проверкой в обычном браузере (§6 приёмки группы 11).
 */

/** Фейковая камера и микрофон: синтетическое изображение и тон. */
const FAKE_DEVICE = '--use-fake-device-for-media-stream';
/** Автоподтверждение запроса разрешений — иначе диалог остановит тест. */
const FAKE_UI = '--use-fake-ui-for-media-stream';

const PORT = 3101;
export const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  // WebRTC поднимается за секунды, но в CI на слабой машине — медленнее.
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    video: 'off',
    // Целевой экран — десктоп от 1024px (PRD §5).
    viewport: { width: 1280, height: 900 },
  },

  projects: [
    {
      name: 'chromium',
      grepInvert: /@denied-media/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 900 },
        permissions: ['camera', 'microphone'],
        launchOptions: { args: [FAKE_DEVICE, FAKE_UI, '--allow-insecure-localhost'] },
      },
    },
    {
      // ★ Только для E11: без фейкового UI и без выданных разрешений — захват
      // недоступен, и `getUserMedia` отказывает по-настоящему (см. заголовок).
      name: 'chromium-no-media',
      grep: /@denied-media/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 900 },
        launchOptions: {
          args: [FAKE_DEVICE, '--deny-permission-prompts', '--allow-insecure-localhost'],
        },
      },
    },
  ],

  webServer: {
    // Собранный артефакт, а не dev-сервер: проверяется то, что уедет в прод.
    command: 'npm run build && npm start',
    url: `${BASE_URL}/health`,
    env: {
      PORT: String(PORT),
      // `/health` внутренний (Q11): для localhost он и так доступен.
      LOG_LEVEL: 'warn',
    },
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
