/**
 * Хелперы E2E (задача IP 13.1, TDD §11.4).
 *
 * Здесь три вещи: независимые участники, чтение статистики WebRTC и опрос
 * состояния плиток.
 *
 * ★ Статистика читается **без единой строки тестового кода в приложении.**
 * `RTCPeerConnection` подменяется через `addInitScript` до загрузки приложения:
 * подкласс складывает свои экземпляры в `window.__pcs`. Альтернатива —
 * выставить соединения на `window` из самого клиента — означала бы тестовый код
 * в продакшен-бандле и возможность «починить» тест, сломав приложение.
 */
import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

/** Каждый участник — отдельный browser context: свои устройства и разрешения. */
export interface Participant {
  name: string;
  page: Page;
  close: () => Promise<void>;
}

/** Идентификатор комнаты: уникальный на каждый тест, иначе тесты видят друг друга. */
export function newRoomId(label: string): string {
  // Только символы из ROOM_ID_PATTERN: [A-Za-z0-9_-]{4,64}.
  const random = Math.random().toString(36).slice(2, 8);
  return `e2e-${label}-${random}`.replace(/[^A-Za-z0-9_-]/g, '');
}

/**
 * Скрипт-перехватчик: собирает созданные `RTCPeerConnection` в `window.__pcs`.
 * Выполняется до кода приложения в каждом документе контекста.
 */
const COLLECT_PEER_CONNECTIONS = `
  (() => {
    const Original = window.RTCPeerConnection;
    window.__pcs = [];
    class Collected extends Original {
      constructor(...args) {
        super(...args);
        window.__pcs.push(this);
      }
    }
    window.RTCPeerConnection = Collected;

    /*
     * ★ Собираем и локальные дорожки (задача 14.5, риск R7).
     *
     * Ровно это показывает chrome://webrtc-internals глазами: остались ли после
     * выхода живые соединения и незакрытые дорожки. Программного API для этой
     * страницы нет, но сами объекты доступны — если их перехватить до старта
     * приложения.
     */
    const getUserMedia = navigator.mediaDevices?.getUserMedia;
    window.__tracks = [];
    if (getUserMedia) {
      navigator.mediaDevices.getUserMedia = function (...args) {
        return getUserMedia.apply(this, args).then((stream) => {
          for (const track of stream.getTracks()) window.__tracks.push(track);
          return stream;
        });
      };
    }
  })();
`;

/**
 * Выдаёт разрешения на устройства.
 *
 * ★ В Firefox `grantPermissions('camera')` не поддерживается: там разрешения и
 * фейковые устройства включаются настройками профиля (см. `playwright.config.ts`).
 * Поэтому вызов пропускается по типу браузера, а не глушится `try/catch` —
 * иначе так же молча проглатывались бы настоящие ошибки.
 */
async function grantMedia(browser: Browser, context: BrowserContext): Promise<void> {
  if (browser.browserType().name() === 'firefox') return;
  await context.grantPermissions(['camera', 'microphone']);
}

/** Открывает нового участника в собственном контексте и входит в комнату. */
export async function joinRoom(
  browser: Browser,
  roomId: string,
  name: string,
  options: { grantMedia?: boolean } = {},
): Promise<Participant> {
  const context = await browser.newContext();
  if (options.grantMedia !== false) await grantMedia(browser, context);
  await context.addInitScript(COLLECT_PEER_CONNECTIONS);

  const page = await context.newPage();
  await page.goto(`/${roomId}`);
  await fillNameAndJoin(page, name);

  return { name, page, close: () => context.close() };
}

/** Открывает участника, но НЕ входит: нужно для проверок экрана входа. */
export async function openRoomPage(
  browser: Browser,
  roomId: string,
  options: { grantMedia?: boolean } = {},
): Promise<Participant> {
  const context = await browser.newContext();
  if (options.grantMedia) await grantMedia(browser, context);
  await context.addInitScript(COLLECT_PEER_CONNECTIONS);

  const page = await context.newPage();
  await page.goto(`/${roomId}`);
  return { name: '', page, close: () => context.close() };
}

/** Ввод имени и вход (ФТ-1). */
export async function fillNameAndJoin(page: Page, name: string): Promise<void> {
  await page.getByLabel('Ваше имя').fill(name);
  await page.getByRole('button', { name: 'Войти' }).click();
}

/** Ждёт, пока участник окажется в комнате: появилась панель управления. */
export async function expectInRoom(page: Page): Promise<void> {
  await expect(page.getByRole('group', { name: 'Управление звонком' })).toBeVisible();
}

/** Плитки участников. */
export function tiles(page: Page) {
  return page.locator('.tile');
}

/** Элементы видео на плитках. */
export function videos(page: Page) {
  return page.locator('video');
}

export interface RtpStats {
  audioBytesReceived: number;
  videoBytesReceived: number;
  videoFramesDecoded: number;
  inboundStreams: number;
}

/**
 * Суммарная входящая статистика по всем соединениям страницы.
 *
 * Именно эта функция отличает «плитка отрисовалась» от «медиа реально идёт»:
 * заглушка, чёрный кадр и остановленная дорожка выглядят в DOM одинаково.
 */
export async function inboundStats(page: Page): Promise<RtpStats> {
  return page.evaluate(async () => {
    const connections = (window as unknown as { __pcs?: RTCPeerConnection[] }).__pcs ?? [];
    const totals = {
      audioBytesReceived: 0,
      videoBytesReceived: 0,
      videoFramesDecoded: 0,
      inboundStreams: 0,
    };

    for (const pc of connections) {
      const report = await pc.getStats();
      report.forEach((entry: RTCStats) => {
        if (entry.type !== 'inbound-rtp') return;
        const stat = entry as RTCInboundRtpStreamStats & { framesDecoded?: number };
        totals.inboundStreams += 1;
        if (stat.kind === 'audio') totals.audioBytesReceived += stat.bytesReceived ?? 0;
        if (stat.kind === 'video') {
          totals.videoBytesReceived += stat.bytesReceived ?? 0;
          totals.videoFramesDecoded += stat.framesDecoded ?? 0;
        }
      });
    }

    return totals;
  });
}

/** Ждёт, пока входящее видео действительно пойдёт (E1: не просто плитка). */
export async function expectIncomingVideo(page: Page): Promise<void> {
  await expect
    .poll(async () => (await inboundStats(page)).videoFramesDecoded, {
      message: 'входящее видео не декодируется',
      timeout: 30_000,
    })
    .toBeGreaterThan(0);
}

/**
 * Проверяет, что аудио продолжает идти: `bytesReceived` растёт между замерами.
 *
 * ★ Ключ теста E6. Одного «значение больше нуля» недостаточно: после остановки
 * дорожки счётчик остаётся на прежнем месте, и проверка прошла бы на мёртвом
 * соединении.
 */
export async function expectAudioKeepsFlowing(page: Page): Promise<void> {
  const before = (await inboundStats(page)).audioBytesReceived;
  await expect
    .poll(async () => (await inboundStats(page)).audioBytesReceived, {
      message: 'входящее аудио перестало расти',
      timeout: 20_000,
    })
    .toBeGreaterThan(before);
}

/** Состояние соединений страницы — для диагностики падений. */
export async function connectionStates(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const connections = (window as unknown as { __pcs?: RTCPeerConnection[] }).__pcs ?? [];
    return connections.map((pc) => pc.connectionState);
  });
}

export interface ResourceState {
  /** Соединения, ещё не переведённые в `closed`. */
  openConnections: number;
  /** Локальные дорожки, ещё не остановленные (`readyState !== 'ended'`). */
  liveTracks: number;
  totalConnections: number;
  totalTracks: number;
}

/**
 * Что осталось живым: соединения и локальные дорожки (задача 14.5, риск R7).
 *
 * Это программный эквивалент ручного чтения `chrome://webrtc-internals`: у
 * страницы нет API, но сами объекты доступны, потому что перехвачены до старта
 * приложения.
 */
export async function resourceState(page: Page): Promise<ResourceState> {
  return page.evaluate(() => {
    const scope = window as unknown as {
      __pcs?: RTCPeerConnection[];
      __tracks?: MediaStreamTrack[];
    };
    const connections = scope.__pcs ?? [];
    const tracks = scope.__tracks ?? [];

    return {
      openConnections: connections.filter((pc) => pc.connectionState !== 'closed').length,
      liveTracks: tracks.filter((track) => track.readyState !== 'ended').length,
      totalConnections: connections.length,
      totalTracks: tracks.length,
    };
  });
}

export interface LatencyStats {
  /** Круговая задержка выбранной ICE-пары, мс; `null` — статистики ещё нет. */
  roundTripMs: number | null;
  /** Задержка буфера воспроизведения видео, мс. */
  videoJitterBufferMs: number | null;
}

/**
 * Задержка по данным `getStats()` (задача 14.3).
 *
 * ★ На loopback это **не** проверка требования «≤ 500 мс»: тут нет ни сети, ни
 * реального кодирования на разных машинах. Функция нужна для двух других вещей:
 * подтвердить, что измеряемые поля вообще заполняются (иначе ручной LAN-замер
 * нечем делать), и дать готовый инструмент для прогона между физическими
 * машинами — см. `docs/manual-verification-video-chat-room.md`.
 */
export async function latencyStats(page: Page): Promise<LatencyStats> {
  return page.evaluate(async () => {
    const connections = (window as unknown as { __pcs?: RTCPeerConnection[] }).__pcs ?? [];
    let roundTripMs: number | null = null;
    let videoJitterBufferMs: number | null = null;

    for (const pc of connections) {
      const report = await pc.getStats();
      report.forEach((entry: RTCStats) => {
        if (entry.type === 'candidate-pair') {
          const pair = entry as RTCIceCandidatePairStats;
          if (pair.state === 'succeeded' && typeof pair.currentRoundTripTime === 'number') {
            roundTripMs = pair.currentRoundTripTime * 1000;
          }
        }
        if (entry.type === 'inbound-rtp') {
          const stat = entry as RTCInboundRtpStreamStats & {
            jitterBufferDelay?: number;
            jitterBufferEmittedCount?: number;
          };
          if (
            stat.kind === 'video' &&
            typeof stat.jitterBufferDelay === 'number' &&
            typeof stat.jitterBufferEmittedCount === 'number' &&
            stat.jitterBufferEmittedCount > 0
          ) {
            videoJitterBufferMs = (stat.jitterBufferDelay / stat.jitterBufferEmittedCount) * 1000;
          }
        }
      });
    }

    return { roundTripMs, videoJitterBufferMs };
  });
}
