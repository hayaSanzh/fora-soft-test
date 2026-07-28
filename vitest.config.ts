import path from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Конфигурация тестов монорепо (задача IP 1.1).
 *
 * Пока весь код исполняется в Node: сервер, общий пакет и чистые функции клиента.
 * Компонентные тесты на jsdom + RTL добавляет группа 12 — там появится отдельный
 * project с `environment: 'jsdom'`, чтобы не тянуть jsdom в серверные тесты.
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
    environment: 'node',
    include: ['{shared,server,client}/src/**/*.test.{ts,tsx}'],
    // Серверные тесты поднимают реальные http/socket.io-серверы на своих портах,
    // поэтому файлы не должны исполняться параллельно в одном процессе.
    fileParallelism: false,
    testTimeout: 15_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['{shared,server,client}/src/**/*.{ts,tsx}'],
      exclude: ['**/*.test.{ts,tsx}', 'client/src/main.tsx'],
      // Порог 75 % включается в CI (задача 15.1), когда появится основной объём кода.
      thresholds: { lines: 0, functions: 0, branches: 0, statements: 0 },
    },
  },
});
