import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { HEALTH_PATH } from '@video-chat/shared';
import { RoomStore } from '../RoomStore.js';
import { createApp, type RoomStats } from './app.js';

const INDEX_HTML = '<!doctype html><title>Видеочат</title><div id="root"></div>';

describe('createApp: /health (ФТ-4, TDD §6.1, Q11)', () => {
  let dist: string;
  let stats: RoomStats;

  beforeAll(() => {
    dist = mkdtempSync(path.join(tmpdir(), 'vcr-dist-'));
    writeFileSync(path.join(dist, 'index.html'), INDEX_HTML);
    writeFileSync(path.join(dist, 'app.js'), 'export const ok = 1;\n');
  });

  afterAll(() => rmSync(dist, { recursive: true, force: true }));

  const app = () =>
    createApp({ getStats: () => stats, staticDir: dist, uptimeSeconds: () => 42.7 });

  it('отвечает 200 и полной формой HealthResponse', async () => {
    stats = { rooms: 3, participants: 9 };
    const res = await request(app()).get(HEALTH_PATH);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', rooms: 3, participants: 9, uptime: 42 });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('счётчики берутся на каждый запрос, а не фиксируются при создании', async () => {
    const server = app();
    stats = { rooms: 0, participants: 0 };
    expect((await request(server).get(HEALTH_PATH)).body.rooms).toBe(0);
    stats = { rooms: 5, participants: 12 };
    expect((await request(server).get(HEALTH_PATH)).body.rooms).toBe(5);
  });

  it('снаружи сети эндпоинта не существует (404, без подробностей)', async () => {
    stats = { rooms: 1, participants: 1 };
    const res = await request(app()).get(HEALTH_PATH).set('X-Forwarded-For', '203.0.113.5');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'NOT_FOUND' });
    expect(JSON.stringify(res.body)).not.toContain('rooms');
  });

  it('изнутри сети через прокси доступ есть', async () => {
    stats = { rooms: 1, participants: 2 };
    const res = await request(app()).get(HEALTH_PATH).set('X-Forwarded-For', '192.168.1.50');

    expect(res.status).toBe(200);
    expect(res.body.participants).toBe(2);
  });

  it('без доверия прокси X-Forwarded-For игнорируется — подделать адрес нельзя', async () => {
    stats = { rooms: 1, participants: 1 };
    const noProxy = createApp({ getStats: () => stats, staticDir: dist, trustProxy: false });

    // Реальный источник — loopback, значит доступ есть, несмотря на заголовок.
    const res = await request(noProxy).get(HEALTH_PATH).set('X-Forwarded-For', '203.0.113.5');
    expect(res.status).toBe(200);
  });
});

describe('createApp: раздача статики и SPA-fallback (ФТ-4)', () => {
  let dist: string;

  beforeAll(() => {
    dist = mkdtempSync(path.join(tmpdir(), 'vcr-dist-'));
    writeFileSync(path.join(dist, 'index.html'), INDEX_HTML);
    writeFileSync(path.join(dist, 'app.js'), 'export const ok = 1;\n');
  });

  afterAll(() => rmSync(dist, { recursive: true, force: true }));

  const app = () => createApp({ getStats: () => ({ rooms: 0, participants: 0 }), staticDir: dist });

  it('отдаёт существующий ассет как есть', async () => {
    const res = await request(app()).get('/app.js');
    expect(res.status).toBe(200);
    expect(res.text).toContain('export const ok');
  });

  it('★ прямой переход по ссылке-приглашению /:roomId отдаёт index.html, а не 404', async () => {
    const res = await request(app()).get('/AbCd1234wXyZ');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('<div id="root">');
  });

  it('отдаёт index.html и на корень, и на вложенный путь', async () => {
    expect((await request(app()).get('/')).status).toBe(200);
    expect((await request(app()).get('/room/AbCd1234wXyZ')).status).toBe(200);
  });

  it('index.html не кешируется — иначе после деплоя отдаётся старый бандл', async () => {
    const res = await request(app()).get('/AbCd1234wXyZ');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('отсутствующий ассет получает 404, а не HTML', async () => {
    const res = await request(app()).get('/assets/missing-abc123.js');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'NOT_FOUND' });
  });

  it('не перехватывает /health своим fallback-ом', async () => {
    const res = await request(app()).get(HEALTH_PATH);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('createApp: /health поверх RoomStore (задачи 1.3 + 3.1)', () => {
  it('показывает живые комнаты и участников, а не число сокетов', async () => {
    const store = new RoomStore();
    const app = createApp({ getStats: () => store.stats() });

    store.join('room-a', 's1', 'Аня', { audio: true, video: true });
    store.join('room-a', 's2', 'Борис', { audio: true, video: true });
    store.join('room-b', 's3', 'Вера', { audio: false, video: false });

    expect((await request(app).get(HEALTH_PATH)).body).toMatchObject({
      status: 'ok',
      rooms: 2,
      participants: 3,
    });

    // Выход последнего участника комнаты уменьшает и счётчик комнат (ФТ-9).
    store.leave('room-b', 's3');

    expect((await request(app).get(HEALTH_PATH)).body).toMatchObject({
      rooms: 1,
      participants: 2,
    });
  });
});

describe('createApp: безопасные заголовки и CSP (задача 4.8, ФТ-39, TDD §10.4)', () => {
  const app = () => createApp({ getStats: () => ({ rooms: 0, participants: 0 }) });

  it('★ CSP разрешает ровно то, что нужно приложению, и ничего больше', async () => {
    const csp = (await request(app()).get(HEALTH_PATH)).headers['content-security-policy'] ?? '';

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    // Локальные медиапотоки приходят как blob:.
    expect(csp).toContain("media-src 'self' blob:");
    // Без wss: сигналинг блокируется при default-src 'self'.
    expect(csp).toContain("connect-src 'self' wss:");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    // Скрипты остаются строгими: 'unsafe-inline' допущен только для стилей.
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(csp).not.toMatch(/script-src[^;]*unsafe-eval/);
  });

  it('ставит остальные заголовки helmet и не раскрывает стек', async () => {
    const res = await request(app()).get(HEALTH_PATH);

    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('createApp: клиент не собран', () => {
  it('вместо белого экрана отдаёт 503 с внятной подсказкой', async () => {
    const app = createApp({
      getStats: () => ({ rooms: 0, participants: 0 }),
      staticDir: path.join(tmpdir(), 'vcr-does-not-exist-42'),
    });

    const res = await request(app).get('/');

    expect(res.status).toBe(503);
    expect(res.body.error).toBe('CLIENT_NOT_BUILT');
    expect(res.body.hint).toContain('npm run build');
  });
});
