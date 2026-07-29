/**
 * Setup-файл project'а `dom` (задача IP 12).
 *
 * Подключает матчеры `@testing-library/jest-dom`: `toBeDisabled`,
 * `toHaveValue`, `toHaveAttribute` и прочие. Смысл не в краткости, а в
 * диагностике — при падении они печатают состояние элемента, тогда как
 * `expect(el.disabled).toBe(true)` сообщает лишь «false вместо true».
 *
 * Подключается только к project'у `dom` (см. `vitest.config.ts`): серверным
 * тестам DOM-матчеры не нужны.
 */
import '@testing-library/jest-dom/vitest';
