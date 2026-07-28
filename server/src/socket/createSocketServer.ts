/**
 * Socket.io-сервер (задача IP 1.4, TDD §4.1, §4.3, §10.4, §12.5).
 *
 * Обработчики событий (`room:join`, сигналинг, чат) регистрирует группа 4 —
 * здесь только транспорт и его параметры, каждый из которых обусловлен
 * требованием, а не вкусом.
 */
import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { SOCKET_PATH } from '@video-chat/shared';
import { config } from '../config.js';
import { logger } from '../logger.js';

export function createSocketServer(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    path: SOCKET_PATH,
    // Без апгрейда с long-polling: экономит round-trip на старте (TDD §9.3).
    transports: [...config.socketTransports],
    // 100 КБ. Занижать нельзя: SDP с несколькими интерфейсами доходит до
    // 10–20 КБ, и маленький буфер порвёт сокет в момент негоциации (§4.3).
    maxHttpBufferSize: config.maxHttpBufferSize,
    // Детект обрыва в пределах ~15 с: auto-reconnect запрещён (ФТ-31),
    // поэтому слот не должен «висеть» (§4.1, риск R8).
    pingInterval: config.pingInterval,
    pingTimeout: config.pingTimeout,
    // Клиентский бандл раздаёт Vite/express, отдавать socket.io.js не нужно.
    serveClient: false,
    cors: {
      // В прод клиент и сервер на одном origin — CORS не нужен вовсе (§10.4).
      origin: [...config.corsOrigins],
      credentials: false,
    },
  });

  io.on('connection', (socket) => {
    // Логируем только идентификатор и транспорт: ни имён, ни текста (§10.5).
    logger.debug(
      { socketId: socket.id, transport: socket.conn.transport.name },
      'socket connected',
    );

    socket.on('disconnect', (reason) => {
      logger.debug({ socketId: socket.id, reason }, 'socket disconnected');
    });
  });

  return io;
}
