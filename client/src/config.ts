/**
 * Конфигурация клиента — ICE, лимиты, constraints, флаги (TDD §2.2, §12.5).
 *
 * Задача IP 0.2: зафиксировать решения по Q5–Q11 (TDD §14) как дефолты.
 * Все значения переопределяются `VITE_*`-переменными на этапе сборки,
 * поэтому уточнение любого из них — изменение конфигурации, не кода.
 *
 * Правило: ни один модуль клиента не читает `import.meta.env` напрямую;
 * русские строки UI живут в `strings.ts` (задача 5.2), не здесь.
 */

/**
 * Доступ к env Vite без зависимости от `vite/client`: типы подтянутся вместе
 * со скаффолдом (задача 1.1), а до тех пор файл должен компилироваться сам по себе.
 */
const env: Record<string, string | undefined> =
  (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

function num(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function optionalNum(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === '') return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function bool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw.trim() === '') return fallback;
  const v = raw.trim().toLowerCase();
  if (v === '1' || v === 'true' || v === 'yes' || v === 'on') return true;
  if (v === '0' || v === 'false' || v === 'no' || v === 'off') return false;
  return fallback;
}

/** Формат `VITE_ICE_SERVERS`: URL'ы через запятую либо JSON-массив `RTCIceServer[]`. */
function iceServers(raw: string | undefined, fallback: RTCIceServer[]): RTCIceServer[] {
  if (raw === undefined || raw.trim() === '') return fallback;
  const trimmed = raw.trim();
  if (trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed as RTCIceServer[];
    } catch {
      return fallback; // битый JSON не должен ронять приложение на старте
    }
    return fallback;
  }
  const urls = trimmed
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return urls.length > 0 ? [{ urls }] : fallback;
}

export const config = {
  // ── Сигналинг (TDD §4.1) ────────────────────────────────────────────────────
  /**
   * Пустая строка = тот же origin, что и страница. В dev это работает через
   * proxy `/socket.io` → :3001 в `vite.config.ts` (задача 1.5), в прод — через
   * nginx. Один origin означает отсутствие CORS в обеих средах.
   */
  socketUrl: env.VITE_SOCKET_URL ?? '',
  /** Таймаут установления соединения; истечение ведёт на экран ошибки сервера (ФТ-35). */
  socketTimeoutMs: num(env.VITE_SOCKET_TIMEOUT_MS, 8_000),

  // ── WebRTC ──────────────────────────────────────────────────────────────────
  /**
   * Публичные Google STUN, TURN нет (PRD §7, риск R1).
   * Подстановка TURN, если решение изменится, — только через эту переменную,
   * править код не потребуется.
   */
  iceServers: iceServers(env.VITE_ICE_SERVERS, [{ urls: 'stun:stun.l.google.com:19302' }]),
  /** Прегенерация кандидатов сокращает время установления соединения (TDD §9.3). */
  iceCandidatePoolSize: num(env.VITE_ICE_CANDIDATE_POOL_SIZE, 2),
  /**
   * `ideal`, а не `exact` (TDD §4.4): на дешёвых веб-камерах `exact`
   * даёт `OverconstrainedError` вместо картинки.
   */
  videoConstraints: {
    width: { ideal: 1280, max: 1280 },
    height: { ideal: 720, max: 720 },
    frameRate: { ideal: 24, max: 30 },
  } as MediaTrackConstraints,
  /**
   * Q5 → закрыт: потолок битрейта по умолчанию **выключен** (`null`).
   * PRD §5 качество не нормирует. Включается значением в бит/с (например
   * 800000) по результатам замера CPU/канала на 4 участниках (задача 14.7).
   */
  maxVideoBitrate: optionalNum(env.VITE_MAX_VIDEO_BITRATE),
  /** Одна попытка `restartIce()` перед пометкой плитки как «нет соединения» (TDD §4.5). */
  iceRestartAttempts: num(env.VITE_ICE_RESTART_ATTEMPTS, 1),

  // ── Комната ─────────────────────────────────────────────────────────────────
  /** Дублирует серверный лимит только для раскладки сетки; истина — на сервере. */
  maxParticipants: num(env.VITE_MAX_PARTICIPANTS, 4),
  /** `nanoid(12)` ≈ 71 бит: `roomId` — единственный секрет комнаты (TDD §5.3, §10.1). */
  roomIdLength: num(env.VITE_ROOM_ID_LENGTH, 12),

  // ── Валидация: зеркало серверных лимитов (TDD §10.3) ────────────────────────
  /** ФТ-38. Q6 → закрыт: whitelist символов; регулярка — в `shared/` (задача 2.3). */
  maxNameLen: num(env.VITE_MAX_NAME_LEN, 30),
  /** Q7 → закрыт: 500 символов; клиент показывает счётчик остатка (задача 10.6). */
  maxMessageLen: num(env.VITE_MAX_MESSAGE_LEN, 500),

  // ── Чат ─────────────────────────────────────────────────────────────────────
  /**
   * Автопрокрутка только если пользователь у нижней границы (TDD §7.5):
   * `scrollHeight - scrollTop - clientHeight < threshold`.
   */
  autoScrollThresholdPx: num(env.VITE_AUTOSCROLL_THRESHOLD_PX, 50),

  // ── UI-флаги ────────────────────────────────────────────────────────────────
  /**
   * Q9 → закрыт: индикация состояния соединения на плитке **включена**.
   * PRD этого не требует, но без неё отсутствие TURN (риск R1) выглядит
   * как необъяснимый чёрный экран (задача 11.6).
   */
  showConnectionState: bool(env.VITE_SHOW_CONNECTION_STATE, true),
} as const;

export type ClientConfig = typeof config;
