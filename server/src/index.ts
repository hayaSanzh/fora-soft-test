/**
 * Точка входа сервера (задачи IP 1.3, 1.4, 4.1–4.9).
 *
 * Один процесс: express раздаёт статику и `/health`, socket.io обслуживает
 * сигналинг, presence и чат, `RoomStore` держит всё состояние в памяти.
 * Один origin и один инстанс — прямое следствие требований PRD (TDD §12.2, §9.4).
 */
import { createServer } from 'node:http';
import { config } from './config.js';
import { logger } from './logger.js';
import { createApp } from './http/app.js';
import { createSocketServer } from './socket/createSocketServer.js';
import { registerSocketHandlers } from './socket/socketHandlers.js';
import { RoomStore } from './RoomStore.js';
import { createShutdown } from './shutdown.js';

const httpServer = createServer();
const io = createSocketServer(httpServer);

/** Единственный владелец состояния на весь процесс (TDD §4.2). */
const rooms = new RoomStore();

registerSocketHandlers(io, rooms);

// Счётчики берутся из стора на каждый запрос: `/health` показывает живые
// комнаты и участников, а не число открытых сокетов (TDD §6.1).
const app = createApp({ getStats: () => rooms.stats() });

httpServer.on('request', app);

httpServer.listen(config.port, config.host, () => {
  logger.info(
    { port: config.port, host: config.host, env: config.nodeEnv, staticDir: config.staticDir },
    'сервер запущен',
  );
});

const shutdown = createShutdown({ io, httpServer });

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
