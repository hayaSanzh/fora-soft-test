/**
 * Публичная точка входа общего пакета (TDD §2.2).
 *
 * Здесь живёт только то, что обязано совпадать у клиента и сервера: типы
 * данных, контракт событий Socket.io, схемы валидации и числовые лимиты.
 */

export * from './protocol.js';
export * from './limits.js';
export * from './types.js';
export * from './events.js';
export * from './validation.js';
