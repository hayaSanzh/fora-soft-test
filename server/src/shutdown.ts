/**
 * Graceful shutdown (задача IP 4.9, Q10, TDD §12.4).
 *
 * Состояние комнат живёт в RAM, а auto-reconnect запрещён требованием ФТ-31.
 * Значит любой рестарт для пользователя — это внезапный обрыв звонка, который
 * без предупреждения выглядит как «сервер сломался». Поэтому перед закрытием
 * соединений всем участникам уходит системное сообщение, и им даётся время
 * доехать: `shutdownGraceMs`.
 *
 * ★ **Graceful не значит «бесконечно».** `httpServer.close()` не закрывает
 * keep-alive соединения — он лишь перестаёт принимать новые и **ждёт**, пока
 * существующие закроются сами. Браузер держит соединения для статики
 * десятками секунд, поэтому наивная реализация висела больше минуты (найдено
 * на ручной приёмке группы 9: 81 с от `SIGINT` до выхода). Отсюда три меры:
 *
 * 1. соединения закрываются **принудительно** после паузы на доставку
 *    сообщения — и websocket'ы, и keep-alive HTTP;
 * 2. есть **страховочный таймер**: если закрытие всё равно не завершилось,
 *    процесс выходит сам, а не остаётся висеть;
 * 3. **повторный сигнал** (оператор нажал `Ctrl+C` второй раз) завершает
 *    процесс немедленно.
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
  /**
   * Крайний срок закрытия соединений. По его истечении процесс завершается
   * принудительно: висящий процесс хуже, чем недозакрытый сокет.
   */
  forceExitAfterMs?: number;
  logger?: Logger;
  now?: () => number;
  generateId?: () => string;
  /** Вызывается после закрытия; по умолчанию завершает процесс. */
  onClosed?: () => void;
  /** Планировщик паузы; в тестах подменяется на мгновенный. */
  delay?: (ms: number) => Promise<void>;
}

/** Возвращает функцию завершения работы. */
export function createShutdown(options: ShutdownOptions): (signal: string) => Promise<void> {
  const {
    io,
    httpServer,
    notice = config.shutdownNotice,
    graceMs = config.shutdownGraceMs,
    forceExitAfterMs = config.shutdownGraceMs + 3_000,
    logger = defaultLogger,
    now = Date.now,
    generateId = () => nanoid(MESSAGE_ID_LENGTH),
    onClosed = () => process.exit(0),
    delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  } = options;

  let started = false;

  return async function shutdown(signal: string): Promise<void> {
    if (started) {
      // Оператор торопится: второй сигнал — это просьба выйти немедленно.
      logger.warn({ signal }, 'повторный сигнал: принудительное завершение');
      onClosed();
      return;
    }
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

    // ★ Принудительное закрытие. Сообщение уже доставлено, ждать больше нечего.
    io.disconnectSockets(true);
    // Keep-alive соединения браузера: без этого `close()` ждёт их таймаута.
    httpServer.closeIdleConnections();
    httpServer.closeAllConnections();

    // Страховка: если закрытие зависло, выходим по таймеру.
    let timedOut = false;
    const watchdog = setTimeout(() => {
      timedOut = true;
      logger.warn({ signal, forceExitAfterMs }, 'закрытие затянулось: принудительный выход');
      onClosed();
    }, forceExitAfterMs);
    watchdog.unref();

    // `io.close()` закрывает и привязанный HTTP-сервер.
    await io.close();
    clearTimeout(watchdog);
    if (timedOut) return;

    logger.info({ signal }, 'соединения закрыты');
    onClosed();
  };
}
