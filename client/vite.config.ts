/**
 * Vite dev-server и сборка клиента (задача IP 1.5, TDD §12.1).
 *
 * Две вещи здесь не косметические:
 *
 * 1. **Secure context.** `getUserMedia` и `RTCPeerConnection` доступны только по
 *    HTTPS; исключение — `localhost`. Поэтому одиночная разработка идёт по http
 *    на localhost, а как только нужен LAN-прогон между машинами (задача 14.3),
 *    требуется TLS: `mkcert` создаёт доверенный сертификат на LAN-IP, и конфиг
 *    подхватывает его автоматически. На `http://192.168.x.x` камера не заведётся —
 *    это самая частая ошибка на этапе LAN-проверки.
 *
 * 2. **Proxy `/socket.io` → :3001 с `ws: true`.** Делает dev-конфигурацию
 *    идентичной прод-сборке: один origin, никакого CORS. Без `ws: true`
 *    WebSocket-апгрейд молча не проходит.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const CERT_DIR = path.resolve(import.meta.dirname, 'certs');
const KEY_FILE = path.join(CERT_DIR, 'key.pem');
const CERT_FILE = path.join(CERT_DIR, 'cert.pem');

/**
 * Сертификаты в репозиторий не попадают (`.gitignore`). Создать их локально:
 *
 *   mkcert -install
 *   mkcert -key-file client/certs/key.pem -cert-file client/certs/cert.pem \
 *          localhost 127.0.0.1 ::1 192.168.x.x
 */
function devHttps(): { key: Buffer; cert: Buffer } | undefined {
  if (!existsSync(KEY_FILE) || !existsSync(CERT_FILE)) return undefined;
  return { key: readFileSync(KEY_FILE), cert: readFileSync(CERT_FILE) };
}

export default defineConfig(({ mode }) => {
  const https = devHttps();
  const backendPort = Number(process.env.SERVER_PORT ?? 3001);
  const backend = `http://127.0.0.1:${backendPort}`;

  if (mode === 'development' && !https) {
    console.info(
      '[vite] certs/{key,cert}.pem не найдены — dev-сервер по http. ' +
        'Для LAN-прогона сгенерируйте сертификат через mkcert (см. vite.config.ts).',
    );
  }

  return {
    plugins: [react()],
    server: {
      port: 5173,
      strictPort: true,
      // 0.0.0.0 нужен для доступа с других машин в LAN; на localhost не влияет.
      host: process.env.VITE_DEV_HOST ?? 'localhost',
      ...(https ? { https } : {}),
      proxy: {
        '/socket.io': {
          target: backend,
          ws: true, // ★ без этого WebSocket-апгрейд не проксируется
          changeOrigin: false,
        },
        '/health': { target: backend, changeOrigin: false },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
      // Один origin в прод: собранную статику раздаёт express (TDD §12.2).
      assetsDir: 'assets',
    },
  };
});
