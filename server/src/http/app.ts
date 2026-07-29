/**
 * Express-приложение: `/health` и раздача SPA (задача IP 1.3, TDD §6.1).
 *
 * Ключевое требование: **SPA-fallback обязателен.** Ссылка-приглашение — это
 * `/:roomId`, и без отдачи `index.html` на произвольный путь прямой переход по
 * ней даёт 404 (ФТ-4). Порядок middleware поэтому фиксирован:
 * `/health` → статика → fallback.
 *
 * Безопасные заголовки (`helmet`, CSP) добавляет задача 4.8: они относятся к
 * контенту, которого на этом шаге ещё нет.
 */
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Express, type Request, type Response } from 'express';
import helmet from 'helmet';
import { HEALTH_PATH, type HealthResponse } from '@video-chat/shared';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { isInternalAddress } from './internalAddress.js';

/** Счётчики для `/health`. В группе 3 источником станет `RoomStore`. */
export interface RoomStats {
  rooms: number;
  participants: number;
}

/**
 * Путь к собранному клиенту.
 *
 * ★ Считается **от расположения этого модуля**, а не от `process.cwd()`.
 * Относительный путь от рабочего каталога — источник дефекта, найденного на
 * ручной приёмке группы 9: `npm start` запускается из корня репозитория, и
 * `'../client/dist'` уходил на уровень выше проекта. Расположение модуля
 * известно всегда: и для `server/dist/http/app.js`, и для исходника в тестах
 * путь до `client/dist` одинаков.
 */
const DEFAULT_STATIC_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../client/dist',
);

/** Явный `STATIC_DIR` резолвится от рабочего каталога — это осознанный выбор оператора. */
export function resolveStaticDir(configured?: string | null): string {
  return configured ? path.resolve(configured) : DEFAULT_STATIC_DIR;
}

export interface CreateAppOptions {
  /** Вызывается на каждый запрос `/health` — счётчики всегда актуальны. */
  getStats: () => RoomStats;
  /** Каталог собранной статики клиента. По умолчанию — из конфигурации. */
  staticDir?: string;
  /** Uptime процесса в секундах; переопределяется в тестах. */
  uptimeSeconds?: () => number;
  /** Значение `app.set('trust proxy')`; по умолчанию из конфигурации. */
  trustProxy?: string | boolean;
}

export function createApp(options: CreateAppOptions): Express {
  const {
    getStats,
    uptimeSeconds = () => process.uptime(),
    trustProxy = config.trustProxy,
  } = options;
  const staticDir = resolveStaticDir(options.staticDir ?? config.staticDir);
  const indexHtml = path.join(staticDir, 'index.html');

  /**
   * Возраст собранного клиента в логе запуска.
   *
   * Практическая необходимость: `npm run verify` не собирает бандл, поэтому
   * легко открыть в браузере старую сборку и «не увидеть» только что
   * написанный код. Строка в логе снимает этот класс недоразумений.
   */
  if (existsSync(indexHtml)) {
    const builtAt = statSync(indexHtml).mtime.toISOString();
    logger.info({ staticDir, builtAt }, 'клиент найден');
  } else {
    logger.warn({ staticDir }, 'клиент не собран: запустите `npm run build`');
  }

  const app = express();

  // За nginx реальный адрес клиента приходит в X-Forwarded-For (TDD §12.2).
  // Дефолт 'loopback' — доверяем только прокси на этой же машине.
  //
  // ⚠ Ограничение проверки «внутри сети»: если порт контейнера опубликован
  // наружу напрямую, source IP всех клиентов подменяется адресом NAT-шлюза
  // docker (172.16.0.0/12) и выглядит внутренним. Поэтому порт публикуется
  // только на loopback (docker-compose.yml), а в прод доступ к /health
  // закрывается ещё и на nginx (задача 15.2).
  app.set('trust proxy', trustProxy);
  app.disable('x-powered-by');

  /**
   * Безопасные заголовки и CSP (задача IP 4.8, TDD §10.4).
   *
   * CSP здесь — не формальность, а вторая линия защиты от XSS после
   * whitelist-валидации и JSX-экранирования (ФТ-39): даже если инъекция
   * когда-нибудь пройдёт, выполнить внешний скрипт или утечь данные на чужой
   * домен она не сможет.
   */
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'"],
          // Локальные медиапотоки приходят как blob: (§10.4).
          'media-src': ["'self'", 'blob:'],
          // WSS — сигналинг на том же origin; wss: нужен явно, иначе
          // соединение блокируется при default-src 'self'.
          'connect-src': ["'self'", 'wss:'],
          'img-src': ["'self'", 'data:', 'blob:'],
          // React ставит инлайновые style-атрибуты; без 'unsafe-inline'
          // ломается вся вёрстка. Скрипты при этом остаются строгими.
          'style-src': ["'self'", "'unsafe-inline'"],
          'font-src': ["'self'"],
          'object-src': ["'none'"],
          'frame-ancestors': ["'none'"],
          'base-uri': ["'self'"],
          'form-action': ["'self'"],
        },
      },
      // Кросс-origin изоляция не нужна: сторонних ресурсов нет, а COEP ломает
      // отладку в dev-окружении.
      crossOriginEmbedderPolicy: false,
    }),
  );

  // ── /health ────────────────────────────────────────────────────────────────
  app.get(HEALTH_PATH, (req: Request, res: Response) => {
    if (config.healthInternalOnly && !isInternalAddress(req.ip, config.healthAllowlist)) {
      // Не 401/403 с подробностями: наружу эндпоинт просто не существует.
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }
    const stats = getStats();
    const body: HealthResponse = {
      status: 'ok',
      rooms: stats.rooms,
      participants: stats.participants,
      uptime: Math.floor(uptimeSeconds()),
    };
    res.set('Cache-Control', 'no-store').json(body);
  });

  // ── Статика клиента ────────────────────────────────────────────────────────
  // maxAge для ассетов с хешем в имени; index.html не кешируется, иначе
  // пользователи будут получать старый бандл после деплоя.
  app.use(
    express.static(staticDir, {
      index: false,
      maxAge: '1h',
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-store');
      },
    }),
  );

  // ── SPA-fallback ───────────────────────────────────────────────────────────
  app.get('*', (req: Request, res: Response) => {
    // Запрос к отсутствующему ассету не должен получать HTML: иначе битый
    // импорт превращается в непонятную ошибку парсинга в браузере.
    if (path.extname(req.path) !== '' && req.path !== '/index.html') {
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }
    if (!existsSync(indexHtml)) {
      logger.warn({ staticDir }, 'index.html не найден: клиент не собран');
      res.status(503).json({
        error: 'CLIENT_NOT_BUILT',
        hint: 'Запустите `npm run build`, либо используйте dev-сервер Vite на :5173',
      });
      return;
    }
    res.set('Cache-Control', 'no-store').sendFile(indexHtml);
  });

  return app;
}
