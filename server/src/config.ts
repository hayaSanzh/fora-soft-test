/**
 * Конфигурация сигнального сервера — единственное место, где живут числовые
 * лимиты и значения по умолчанию (TDD §12.5).
 *
 * Задача IP 0.2: зафиксировать решения по открытым вопросам Q5–Q11 (TDD §14)
 * в виде дефолтов. Каждое значение переопределяется переменной окружения,
 * поэтому уточнение любого из Q5–Q11 по ходу реализации — изменение
 * конфигурации, а не кода.
 *
 * Правило: ни один модуль сервера не читает `process.env` напрямую.
 */

/** Читает целое число из env; при отсутствии/мусоре возвращает `fallback`. */
function num(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Читает boolean из env: `1|true|yes|on` → true, `0|false|no|off` → false. */
function bool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw.trim() === '') return fallback;
  const v = raw.trim().toLowerCase();
  if (v === '1' || v === 'true' || v === 'yes' || v === 'on') return true;
  if (v === '0' || v === 'false' || v === 'no' || v === 'off') return false;
  return fallback;
}

/** Читает список, разделённый запятыми; пустые элементы отбрасываются. */
function list(raw: string | undefined, fallback: string[]): string[] {
  if (raw === undefined || raw.trim() === '') return fallback;
  const items = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return items.length > 0 ? items : fallback;
}

const env = process.env;

export const config = {
  /** Окружение процесса. Влияет на уровень логов и на строгость CSP (задача 4.8). */
  nodeEnv: env.NODE_ENV ?? 'development',

  // ── HTTP / транспорт ────────────────────────────────────────────────────────
  /** Порт Node-процесса. За nginx проксируется на 127.0.0.1:3001 (TDD §12.2). */
  port: num(env.PORT, 3001),
  /** Интерфейс прослушивания. В контейнере нужен 0.0.0.0. */
  host: env.HOST ?? '0.0.0.0',
  /** Каталог собранной статики клиента, раздаётся express (TDD §6.1). */
  staticDir: env.STATIC_DIR ?? '../client/dist',
  /**
   * Точный список разрешённых origin'ов (TDD §10.4).
   * В прод-сборке клиент и сервер на одном origin — CORS не нужен вовсе,
   * поэтому дефолт покрывает только dev-адреса Vite.
   */
  corsOrigins: list(env.CORS_ORIGIN, ['https://localhost:5173', 'http://localhost:5173']),

  // ── Socket.io ───────────────────────────────────────────────────────────────
  /** Только websocket, без апгрейда с long-polling (TDD §4.1, §9.3). */
  socketTransports: ['websocket'] as const,
  /**
   * Q11 → закрыт: `/health` доступен только внутри сети.
   * Ограничение реализуется на уровне nginx (задача 15.2) плюс проверка
   * адреса в обработчике (задача 1.3). Флаг оставлен, чтобы открыть
   * эндпоинт внешнему мониторингу без пересборки.
   */
  healthInternalOnly: bool(env.HEALTH_INTERNAL_ONLY, true),
  /** Кто считается «внутренней сетью» для `/health` при `healthInternalOnly`. */
  healthAllowlist: list(env.HEALTH_ALLOWLIST, ['127.0.0.1', '::1', '10.', '172.16.', '192.168.']),
  /**
   * Скорость детекта обрыва (TDD §4.1, §12.5, риск R8).
   * 10 000 / 5 000 → участник удаляется из комнаты в пределах ~15 с.
   * Занижение даёт ложные выбытия на нестабильном Wi-Fi, а auto-reconnect
   * запрещён требованием ФТ-31, поэтому цена ошибки высока.
   */
  pingInterval: num(env.PING_INTERVAL, 10_000),
  pingTimeout: num(env.PING_TIMEOUT, 5_000),
  /**
   * 100 КБ (TDD §4.3). Занижать нельзя: SDP с `iceCandidatePoolSize`
   * и несколькими сетевыми интерфейсами доходит до 10–20 КБ, и слишком
   * маленький буфер порвёт сокет ровно в момент негоциации.
   */
  maxHttpBufferSize: num(env.MAX_HTTP_BUFFER_SIZE, 100_000),

  // ── Комнаты ─────────────────────────────────────────────────────────────────
  /**
   * Лимит участников. 4 — следствие mesh-топологии (TDD §9.2), не UX-решение.
   * Вынесен в env как feature-flag для нагрузочных экспериментов (§12.5).
   */
  maxParticipants: num(env.MAX_PARTICIPANTS, 4),
  /**
   * Q8 → закрыт: глубина истории чата 200 сообщений (ring buffer, TDD §4.2).
   * Поздний участник получает последние `maxMessages` — этого достаточно
   * для ФТ-23, а комната перестаёт неограниченно расти в памяти.
   */
  maxMessages: num(env.MAX_MESSAGES, 200),

  // ── Валидация (зеркало клиентских лимитов, TDD §10.3) ───────────────────────
  /**
   * ФТ-38: имя ≤ 30 символов.
   * Q6 → закрыт: набор символов — whitelist `\p{L}\p{N}` + пробел, `.`, `_`, `-`
   * (кириллица и латиница разрешены). Сама схема — в `shared/` (задача 2.3),
   * здесь только длина, чтобы не расходились числа.
   */
  maxNameLen: num(env.MAX_NAME_LEN, 30),
  /**
   * Q7 → закрыт: лимит длины сообщения 500 символов (ФТ-40).
   * PRD оставляет значение на усмотрение разработчика.
   */
  maxMessageLen: num(env.MAX_MESSAGE_LEN, 500),

  // ── Антифлуд (TDD §10.4) ────────────────────────────────────────────────────
  /**
   * Q7 → закрыт: чат — token bucket на сокет, burst 5 и refill 1/с.
   * Превышение отвечает `RATE_LIMITED` и **не рвёт сокет** (задача 4.7).
   */
  chatRateBurst: num(env.CHAT_RATE_BURST, 5),
  chatRateRefillPerSec: num(env.CHAT_RATE_REFILL, 1),
  /**
   * Сигналинг: 100 событий `signal:*` за 10 с на сокет. Превышение — это
   * уже не человек, поэтому здесь сокет отключается (TDD §10.4).
   */
  signalRateMax: num(env.SIGNAL_RATE_MAX, 100),
  signalRateWindowMs: num(env.SIGNAL_RATE_WINDOW_MS, 10_000),

  // ── Завершение работы (TDD §12.4) ───────────────────────────────────────────
  /**
   * Q10 → закрыт: при graceful shutdown рассылаем системное сообщение
   * о завершении работы. Без него рестарт выглядит как «сервер недоступен»,
   * потому что auto-reconnect отключён и состояние в RAM непереносимо.
   */
  shutdownNotice: bool(env.SHUTDOWN_NOTICE, true),
  /** Пауза на доставку системного сообщения перед закрытием соединений. */
  shutdownGraceMs: num(env.SHUTDOWN_GRACE_MS, 2_000),

  // ── Логи ────────────────────────────────────────────────────────────────────
  /**
   * pino. Текст сообщений чата не логируется никогда (TDD §10.5) —
   * это свойство логгера (задача 1.4), а не уровня логирования.
   */
  logLevel: env.LOG_LEVEL ?? 'info',
} as const;

export type ServerConfig = typeof config;
