import path from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Конфигурация тестов монорепо (задача IP 1.1; проект `dom` — задача 12).
 *
 * Два project'а вместо одного окружения:
 *
 * - **node** — сервер, общий пакет, чистая логика клиента и разметка через
 *   `react-dom/server`. Файлы исполняются последовательно: серверные тесты
 *   поднимают настоящие http/socket.io-серверы на своих портах.
 * - **dom** — компонентные тесты на jsdom + RTL (группа 12). Отдельный project
 *   нужен, чтобы **не тянуть jsdom в серверные тесты**: он заметно медленнее и
 *   подменяет глобальные объекты, которых на сервере быть не должно.
 *
 * ★ Признак проекта — суффикс `.dom.test.tsx`, а не каталог: компонентные тесты
 * лежат рядом с компонентами, как и все остальные тесты в проекте.
 */
export default defineConfig({
  resolve: {
    alias: {
      // Тесты работают с исходниками общего пакета, а не с собранным dist:
      // иначе покрытие по shared/ всегда нулевое, а прогон требует пересборки.
      '@video-chat/shared': path.resolve(import.meta.dirname, 'shared/src/index.ts'),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['{shared,server,client}/src/**/*.test.{ts,tsx}'],
          // Компонентные тесты уходят в project `dom`.
          exclude: ['**/*.dom.test.tsx'],
          fileParallelism: false,
          testTimeout: 15_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'dom',
          environment: 'jsdom',
          include: ['client/src/**/*.dom.test.tsx'],
          setupFiles: ['client/src/domMatchers.test-utils.ts'],
          testTimeout: 15_000,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['{shared,server,client}/src/**/*.{ts,tsx}'],
      exclude: ['**/*.test.{ts,tsx}', 'client/src/main.tsx'],
      /*
       * Порог из TDD §11.1 включён в группе 12, когда появился основной объём
       * кода: фактические 94 % строк иначе могли бы молча просесть за оставшиеся
       * группы. В CI это станет отдельным шагом (задача 15.1).
       *
       * Порог именно 75 %, а не «по факту»: планка не должна расти сама от
       * удачного прогона, иначе любой новый непокрытый модуль ломает сборку и
       * порог начинают понижать вручную.
       */
      thresholds: { lines: 75, functions: 75, branches: 75, statements: 75 },
    },
  },
});
