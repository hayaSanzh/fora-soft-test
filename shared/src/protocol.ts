/**
 * Транспортные константы и форма HTTP-ответов — то, что клиент и сервер
 * обязаны понимать одинаково (TDD §6.1).
 */

/** Путь Socket.io. Совпадает с дефолтом библиотеки и с proxy-правилом Vite (§12.1). */
export const SOCKET_PATH = '/socket.io';

/** Liveness/readiness-эндпоинт (§6.1). Доступен только внутри сети — Q11 (§14.2). */
export const HEALTH_PATH = '/health';

/** Ответ `GET /health` (§6.1). */
export interface HealthResponse {
  status: 'ok';
  /** Число живых комнат в памяти процесса. */
  rooms: number;
  /** Суммарное число участников во всех комнатах. */
  participants: number;
  /** Uptime процесса в секундах, целое. */
  uptime: number;
}
