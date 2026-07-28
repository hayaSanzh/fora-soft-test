/**
 * Точка входа сервера (задачи IP 1.3, 1.4).
 *
 * Один процесс: express раздаёт статику и `/health`, socket.io обслуживает
 * сигналинг. Один origin и одно состояние в памяти — прямое следствие
 * требований PRD (TDD §12.2, §9.4).
 */
import { createServer } from 'node:http';
import { config } from './config.js';
import { logger } from './logger.js';
import { createApp } from './http/app.js';
import { createSocketServer } from './socket/createSocketServer.js';
import { RoomStore } from './RoomStore.js';

const httpServer = createServer();
const io = createSocketServer(httpServer);

/**
 * Единственный владелец состояния на весь процесс (TDD §4.2).
 * Обработчики событий подключаются к нему в группе 4.
 */
const rooms = new RoomStore();

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

/**
 * Завершение работы. Рассылку системного сообщения о завершении и паузу
 * `shutdownGraceMs` добавляет задача 4.9 — она требует чата, которого ещё нет.
 * Здесь пока корректное закрытие соединений, без него `docker stop` ждёт таймаут.
 */
function shutdown(signal: string): void {
  logger.info({ signal }, 'завершение работы');
  void io.close(() => {
    httpServer.close(() => {
      process.exit(0);
    });
  });
  // Страховка: если соединения не закрылись, не висим бесконечно.
  setTimeout(() => process.exit(0), config.shutdownGraceMs + 3_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
