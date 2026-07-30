// @ts-check
/**
 * ESLint 9 (flat config) — задача IP 1.2.
 *
 * Помимо обычной гигиены здесь живут **правила-«стражи»**: они механически
 * запрещают конструкции, которые нарушают требования PRD и роняют дизайн.
 * Каждое такое правило сопровождается ссылкой на требование — правило без
 * объяснения рано или поздно отключают.
 */
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';

/** Запрет любого сохранения состояния на клиенте — PRD §5, ФТ-39, TDD §5.4. */
const noWebStorageRules = {
  'no-restricted-globals': [
    'error',
    {
      name: 'localStorage',
      message:
        'PRD §5: состояние на клиенте не сохраняется. Имя и история не переживают перезагрузку.',
    },
    {
      name: 'sessionStorage',
      message: 'PRD §5: состояние на клиенте не сохраняется.',
    },
  ],
  'no-restricted-properties': [
    'error',
    {
      object: 'window',
      property: 'localStorage',
      message: 'PRD §5: состояние на клиенте не сохраняется.',
    },
    {
      object: 'window',
      property: 'sessionStorage',
      message: 'PRD §5: состояние на клиенте не сохраняется.',
    },
    {
      object: 'document',
      property: 'cookie',
      message: 'PRD §5: cookie-трекинга и сохранения состояния нет (TDD §10.5).',
    },
  ],
  'no-restricted-syntax': [
    'error',
    {
      // Перехватывает и `indexedDB.open(...)`, и `window.indexedDB`.
      selector: "Identifier[name='indexedDB']",
      message: 'PRD §5: персистентности на клиенте нет.',
    },
    {
      // TDD R4: `removeTrack` даёт 6 SDP-обменов на клик по камере вместо нуля.
      // Правильный путь — `sender.replaceTrack(null)` (TDD §4.4, §4.5, задача 7.4).
      selector: "MemberExpression > Identifier[name='removeTrack']",
      message:
        'TDD R4: вместо pc.removeTrack() используйте sender.replaceTrack(null) — иначе ренегоциация на каждый тумблер камеры.',
    },
  ],
};

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      'docs/**',
      'client/certs/**',
      'test-results/**',
      'playwright-report/**',
    ],
  },

  // ── Базовые правила для всего JS/TS ──────────────────────────────────────────
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            'eslint.config.js',
            'vitest.config.ts',
            'playwright.config.ts',
            'scripts/*.mjs',
          ],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // Забытый await в WebRTC-коде даёт гонки, которые крайне тяжело ловить.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
    },
  },

  // ── Серверный код ───────────────────────────────────────────────────────────
  {
    files: ['server/src/**/*.ts', 'shared/src/**/*.ts'],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      // Логи только через pino: он один умеет не писать текст сообщений (TDD §10.5, §12.5).
      'no-console': 'error',
    },
  },

  // ── Клиентский код ──────────────────────────────────────────────────────────
  {
    files: ['client/src/**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.browser,
    },
    plugins: { react, 'react-hooks': reactHooks },
    settings: { react: { version: 'detect' } },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...react.configs.flat['jsx-runtime'].rules,
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // ★ Страж XSS: экранирование только на выходе через JSX (ФТ-39, TDD §10.3).
      'react/no-danger': 'error',
      'react/jsx-no-target-blank': 'error',
      // Ссылки в чате не автолинкуются — вектор javascript: URL (TDD §10.3).
      'react/jsx-no-script-url': 'error',

      ...noWebStorageRules,
      'no-console': 'error',
    },
  },

  // Общий код тоже не должен трогать web storage, даже если исполняется в браузере.
  {
    files: ['shared/src/**/*.ts'],
    rules: noWebStorageRules,
  },

  // ── Тесты ───────────────────────────────────────────────────────────────────
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/*.test-utils.ts', 'e2e/**/*.ts'],
    rules: {
      // В тестах допустима работа с console: заглушение шумных предупреждений
      // библиотек и диагностика падений.
      'no-console': 'off',
      // В тестах допустимы небезопасные приведения при работе с моками.
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  // ── Конфигурационные файлы ──────────────────────────────────────────────────
  // Типизированные правила здесь выключены: файлы не входят в tsconfig
  // воркспейсов, поэтому типы плагинов не разрешаются и правила дают ложные
  // «unsafe any» на каждый импорт.
  {
    files: [
      'eslint.config.js',
      'vitest.config.ts',
      'playwright.config.ts',
      // Скрипты эксплуатации (задача 15.4): обычный Node без сборки, в tsconfig
      // воркспейсов не входят.
      'scripts/**/*.mjs',
    ],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: { globals: globals.node },
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
      // Инструменты эксплуатации печатают результат в stdout — это их назначение.
      'no-console': 'off',
    },
  },
  {
    files: ['client/vite.config.ts'],
    languageOptions: { globals: globals.node },
    rules: { 'no-console': 'off' },
  },

  // Prettier последним: снимает конфликтующие стилевые правила.
  prettier,
);
