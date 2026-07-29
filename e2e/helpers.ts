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
import { expect, type Browser, type Page } from '@playwright/test';

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
  })();
`;

/** Открывает нового участника в собственном контексте и входит в комнату. */
export async function joinRoom(
  browser: Browser,
  roomId: string,
  name: string,
  options: { grantMedia?: boolean } = {},
): Promise<Participant> {
  const context = await browser.newContext();
  if (options.grantMedia !== false) {
    // В project'е без `--use-fake-ui` разрешения выдаются точечно.
    await context.grantPermissions(['camera', 'microphone']);
  }
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
  if (options.grantMedia) await context.grantPermissions(['camera', 'microphone']);
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
