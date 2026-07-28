/**
 * Graceful shutdown (задача IP 4.9, Q10, TDD §12.4).
 *
 * Состояние комнат живёт в RAM, а auto-reconnect запрещён требованием ФТ-31.
 * Значит любой рестарт для пользователя — это внезапный обрыв звонка, который
 * без предупреждения выглядит как «сервер сломался». Поэтому перед закрытием
 * соединений всем участникам уходит системное сообщение, и им даётся время
 * доехать: `shutdownGraceMs`.
 */
import type { Server as HttpServer } from 'node:http';
import { MESSAGE_ID_LENGTH, type SystemChatItem } from '@video-chat/shared';
import { nanoid } from 'nanoid';
import { config } from './config.js';
import { logger as defaultLogger, type Logger } from './logger.js';
import type { TypedServer } from './socket/types.js';

export interface ShutdownOptions {
  io: TypedServer;
  httpServer: HttpServer;
  /** Рассылать ли системное сообщение (Q10). */
  notice?: boolean;
  /** Пауза на доставку сообщения перед закрытием соединений. */
  graceMs?: number;
  logger?: Logger;
  now?: () => number;
  generateId?: () => string;
  /** Вызывается после закрытия; по умолчанию завершает процесс. */
  onClosed?: () => void;
  /** Планировщик паузы; в тестах подменяется на мгновенный. */
  delay?: (ms: number) => Promise<void>;
}

/**
 * Возвращает функцию завершения работы. Повторный вызов игнорируется: два
 * сигнала подряд (`SIGTERM` от оркестратора + `SIGINT` от оператора) не должны
 * запускать две параллельные остановки.
 */
export function createShutdown(options: ShutdownOptions): (signal: string) => Promise<void> {
  const {
    io,
    httpServer,
    notice = config.shutdownNotice,
    graceMs = config.shutdownGraceMs,
    logger = defaultLogger,
    now = Date.now,
    generateId = () => nanoid(MESSAGE_ID_LENGTH),
    onClosed = () => process.exit(0),
    delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  } = options;

  let started = false;

  return async function shutdown(signal: string): Promise<void> {
    if (started) return;
    started = true;
    logger.info({ signal }, 'завершение работы');

    if (notice) {
      const item: SystemChatItem = {
        type: 'system',
        id: generateId(),
        kind: 'shutdown',
        // Сообщение не о участнике, а о сервере: имени здесь нет.
        name: '',
        ts: now(),
      };
      // Рассылается всем подключённым: комнаты сейчас же перестанут существовать.
      io.emit('chat:message', item);
      await delay(graceMs);
    }

    await io.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    logger.info({ signal }, 'соединения закрыты');
    onClosed();
  };
}
