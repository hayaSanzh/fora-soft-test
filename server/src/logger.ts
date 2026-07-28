/**
 * Логгер (задача IP 1.4, TDD §10.5, §12.5).
 *
 * Требование ФТ-35/§10.5: **текст сообщений чата в логи не попадает никогда.**
 * Это свойство самого логгера, а не дисциплины вызывающего кода: `redact`
 * вырезает поля с пользовательским содержимым на уровне сериализатора, поэтому
 * даже случайный `logger.info({ text })` не приведёт к утечке.
 */
import pino from 'pino';
import { config } from './config.js';

/**
 * Поля с пользовательским содержимым, запрещённые в логах: текст сообщений
 * (§10.5) и отображаемые имена (персональные данные по §10.5).
 *
 * `err.name` и подобные диагностические поля сознательно не задеты — вырезаются
 * только корневые `name`/`text` и одноуровневые вложения вида `payload.text`,
 * иначе разбор ошибок в логах станет невозможным.
 */
export const REDACTED_PATHS = [
  'text',
  '*.text',
  'name',
  'participant.name',
  'participants[*].name',
] as const;

export const logger = pino({
  level: config.logLevel,
  redact: {
    paths: [...REDACTED_PATHS],
    censor: '[redacted]',
  },
  base: { service: 'video-chat-server' },
  ...(config.nodeEnv === 'development'
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname,service' },
        },
      }
    : {}),
});

export type Logger = typeof logger;
