/**
 * Тесты локальных дорожек и тумблеров (задача IP 7, TDD §4.4).
 *
 * Устройства подменяются фейком, поэтому проверяются именно те ветки, которые
 * в браузере воспроизводятся тяжело: отказ в доступе к одному устройству из
 * двух, `OverconstrainedError` с ретраем, физическое исчезновение камеры.
 *
 * Ключевые утверждения файла:
 * - микрофон выключается через `enabled`, дорожка **не** останавливается (ФТ-15);
 * - камера выключается через `stop()` — иначе не гаснет индикатор (ФТ-19);
 * - отказ в доступе **не** мешает войти в комнату (ФТ-14, ФТ-33).
 */
import { describe, expect, it, vi } from 'vitest';
import { LocalMedia, toMediaErrorKind } from './localMedia';

/** Минимальная дорожка: только то, чем пользуется реализация. */
class FakeTrack {
  enabled = true;
  readonly stops: number[] = [];
  onended: (() => void) | null = null;

  constructor(public readonly kind: 'audio' | 'video') {}

  stop(): void {
    this.stops.push(Date.now());
  }

  /** Эмулирует физическое отключение устройства (ФТ-20). */
  end(): void {
    this.onended?.();
  }

  get stopped(): boolean {
    return this.stops.length > 0;
  }
}

class FakeStream {
  constructor(private readonly tracks: FakeTrack[]) {}
  getAudioTracks(): FakeTrack[] {
    return this.tracks.filter((t) => t.kind === 'audio');
  }
  getVideoTracks(): FakeTrack[] {
    return this.tracks.filter((t) => t.kind === 'video');
  }
}

function domError(name: string): Error {
  const error = new Error(name);
  error.name = name;
  return error;
}

interface FakeDevicesOptions {
  audio?: 'ok' | Error;
  video?: 'ok' | Error;
  /** Первый вызов video падает указанной ошибкой, второй — успешен (ретрай). */
  videoFirstCallError?: Error;
}

interface FakeDevices {
  devices: MediaDevices;
  calls: MediaStreamConstraints[];
  audioTracks: FakeTrack[];
  videoTracks: FakeTrack[];
  listeners: Record<string, (() => void)[]>;
  fireDeviceChange: () => void;
}

function fakeDevices(options: FakeDevicesOptions = {}): FakeDevices {
  const calls: MediaStreamConstraints[] = [];
  const audioTracks: FakeTrack[] = [];
  const videoTracks: FakeTrack[] = [];
  const listeners: Record<string, (() => void)[]> = {};
  let videoCalls = 0;

  const devices = {
    getUserMedia: (constraints: MediaStreamConstraints) => {
      calls.push(constraints);
      if (constraints.audio) {
        if (options.audio && options.audio !== 'ok') return Promise.reject(options.audio);
        const track = new FakeTrack('audio');
        audioTracks.push(track);
        return Promise.resolve(new FakeStream([track]) as unknown as MediaStream);
      }
      videoCalls += 1;
      if (options.videoFirstCallError && videoCalls === 1) {
        return Promise.reject(options.videoFirstCallError);
      }
      if (options.video && options.video !== 'ok') return Promise.reject(options.video);
      const track = new FakeTrack('video');
      videoTracks.push(track);
      return Promise.resolve(new FakeStream([track]) as unknown as MediaStream);
    },
    addEventListener: (type: string, listener: () => void) => {
      (listeners[type] ??= []).push(listener);
    },
    removeEventListener: (type: string, listener: () => void) => {
      listeners[type] = (listeners[type] ?? []).filter((l) => l !== listener);
    },
  } as unknown as MediaDevices;

  return {
    devices,
    calls,
    audioTracks,
    videoTracks,
    listeners,
    fireDeviceChange: () => (listeners.devicechange ?? []).forEach((l) => l()),
  };
}

describe('toMediaErrorKind (задача 7.2, TDD §8.1)', () => {
  it.each([
    ['NotAllowedError', 'NotAllowedError'],
    ['PermissionDeniedError', 'NotAllowedError'],
    ['NotFoundError', 'NotFoundError'],
    ['DevicesNotFoundError', 'NotFoundError'],
    ['NotReadableError', 'NotReadableError'],
    ['TrackStartError', 'NotReadableError'],
    ['OverconstrainedError', 'OverconstrainedError'],
    ['SomethingElse', 'Unknown'],
  ])('%s → %s', (name, expected) => {
    expect(toMediaErrorKind(domError(name))).toBe(expected);
  });
});

describe('acquire: раздельные вызовы getUserMedia (задача 7.1, ФТ-13, ФТ-14)', () => {
  it('★ оба устройства доступны: микрофон и камера включены по умолчанию (ФТ-13)', async () => {
    const f = fakeDevices();
    const local = new LocalMedia({ mediaDevices: f.devices });

    const state = await local.acquire();

    expect(state).toEqual({ audio: true, video: true });
    // Два независимых вызова, а не один совмещённый.
    expect(f.calls).toHaveLength(2);
    expect(f.calls[0]).toEqual({ audio: true });
    expect(f.calls[1]).toHaveProperty('video');
  });

  it('★ нет микрофона → камера всё равно получена (ФТ-14, US-6)', async () => {
    const f = fakeDevices({ audio: domError('NotFoundError') });
    const onError = vi.fn();
    const local = new LocalMedia({ mediaDevices: f.devices, onError });

    const state = await local.acquire();

    expect(state).toEqual({ audio: false, video: true });
    expect(onError).toHaveBeenCalledWith('NotFoundError');
  });

  it('★ нет камеры → микрофон всё равно получен (ФТ-14)', async () => {
    const f = fakeDevices({ video: domError('NotFoundError') });
    const local = new LocalMedia({ mediaDevices: f.devices });

    expect(await local.acquire()).toEqual({ audio: true, video: false });
  });

  it('★ отказ в доступе к обоим устройствам не бросает исключение (ФТ-33, US-12)', async () => {
    const f = fakeDevices({
      audio: domError('NotAllowedError'),
      video: domError('NotAllowedError'),
    });
    const onError = vi.fn();
    const local = new LocalMedia({ mediaDevices: f.devices, onError });

    const state = await local.acquire();

    // Вход в комнату продолжается: пользователь войдёт «слушателем».
    expect(state).toEqual({ audio: false, video: false });
    expect(onError).toHaveBeenCalledWith('NotAllowedError');
  });

  it('★ OverconstrainedError → повторный запрос без ограничений (задача 7.2)', async () => {
    const f = fakeDevices({ videoFirstCallError: domError('OverconstrainedError') });
    const local = new LocalMedia({ mediaDevices: f.devices });

    const state = await local.acquire();

    expect(state.video).toBe(true);
    // Три вызова: audio, video с constraints, video без них.
    expect(f.calls).toHaveLength(3);
    expect(f.calls[2]).toEqual({ video: true });
  });

  it('устройство занято другим приложением (NotReadableError) — вход продолжается', async () => {
    const f = fakeDevices({ video: domError('NotReadableError') });
    const onError = vi.fn();
    const local = new LocalMedia({ mediaDevices: f.devices, onError });

    expect((await local.acquire()).audio).toBe(true);
    expect(onError).toHaveBeenCalledWith('NotReadableError');
  });

  it('дорожки уходят наружу колбэками — шов для PeerManager (группа 8)', async () => {
    const f = fakeDevices();
    const onAudioTrack = vi.fn();
    const onVideoTrack = vi.fn();
    const local = new LocalMedia({ mediaDevices: f.devices, onAudioTrack, onVideoTrack });

    await local.acquire();

    expect(onAudioTrack).toHaveBeenCalledWith(f.audioTracks[0]);
    expect(onVideoTrack).toHaveBeenCalledWith(f.videoTracks[0]);
  });
});

describe('тумблер микрофона (задача 7.3, ФТ-15, ФТ-16)', () => {
  it('★ выключение через enabled: дорожка остаётся живой и НЕ останавливается', async () => {
    const f = fakeDevices();
    const local = new LocalMedia({ mediaDevices: f.devices });
    await local.acquire();
    const track = f.audioTracks[0]!;

    const state = await local.setMicEnabled(false);

    expect(state.audio).toBe(false);
    expect(track.enabled).toBe(false);
    // ★ Останавливать нельзя: иначе включение стоило бы getUserMedia и SDP-обмена.
    expect(track.stopped).toBe(false);
    expect(local.getAudioTrack()).toBe(track);
  });

  it('включение возвращает ту же дорожку без нового getUserMedia', async () => {
    const f = fakeDevices();
    const local = new LocalMedia({ mediaDevices: f.devices });
    await local.acquire();
    const callsAfterAcquire = f.calls.length;
    await local.setMicEnabled(false);

    const state = await local.setMicEnabled(true);

    expect(state.audio).toBe(true);
    expect(f.audioTracks[0]?.enabled).toBe(true);
    expect(f.calls).toHaveLength(callsAfterAcquire);
  });

  it('состояние рассылается на каждое переключение (ФТ-16)', async () => {
    const f = fakeDevices();
    const onStateChange = vi.fn();
    const local = new LocalMedia({ mediaDevices: f.devices, onStateChange });
    await local.acquire();
    onStateChange.mockClear();

    await local.setMicEnabled(false);
    await local.setMicEnabled(true);

    expect(onStateChange).toHaveBeenNthCalledWith(1, { audio: false, video: true });
    expect(onStateChange).toHaveBeenNthCalledWith(2, { audio: true, video: true });
  });

  it('★ если микрофона не было, включение пробует получить его снова', async () => {
    let failNext = true;
    const f = fakeDevices();
    const devices = {
      ...f.devices,
      getUserMedia: (constraints: MediaStreamConstraints) => {
        if (constraints.audio && failNext) {
          failNext = false;
          return Promise.reject(domError('NotAllowedError'));
        }
        return f.devices.getUserMedia(constraints);
      },
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    } as unknown as MediaDevices;
    const local = new LocalMedia({ mediaDevices: devices });
    await local.acquire();
    expect(local.state.audio).toBe(false);

    // Пользователь разрешил доступ в настройках браузера и нажал тумблер.
    expect((await local.setMicEnabled(true)).audio).toBe(true);
  });

  it('повторный отказ оставляет микрофон выключенным и показывает ошибку', async () => {
    const f = fakeDevices({ audio: domError('NotAllowedError') });
    const onError = vi.fn();
    const local = new LocalMedia({ mediaDevices: f.devices, onError });
    await local.acquire();
    onError.mockClear();

    expect((await local.setMicEnabled(true)).audio).toBe(false);
    expect(onError).toHaveBeenCalledWith('NotAllowedError');
  });
});

describe('тумблер камеры (задача 7.4, ФТ-17, ФТ-19, риск R4)', () => {
  it('★ выключение: сначала снятие с senders, затем stop() — гаснет индикатор', async () => {
    const f = fakeDevices();
    const order: string[] = [];
    const local = new LocalMedia({
      mediaDevices: f.devices,
      onVideoTrack: (track) => order.push(track === null ? 'replaceTrack(null)' : 'replaceTrack'),
    });
    await local.acquire();
    const track = f.videoTracks[0]!;
    order.length = 0;

    const state = await local.setCameraEnabled(false);

    expect(state.video).toBe(false);
    // ★ ФТ-19: дорожка именно остановлена, а не просто отключена.
    expect(track.stopped).toBe(true);
    expect(local.getVideoTrack()).toBeNull();
    // Порядок: перестаём отправлять → освобождаем железо.
    expect(order).toEqual(['replaceTrack(null)']);
  });

  it('★ включение: новый getUserMedia и новая дорожка в senders', async () => {
    const f = fakeDevices();
    const onVideoTrack = vi.fn();
    const local = new LocalMedia({ mediaDevices: f.devices, onVideoTrack });
    await local.acquire();
    await local.setCameraEnabled(false);
    onVideoTrack.mockClear();
    const callsBefore = f.calls.length;

    const state = await local.setCameraEnabled(true);

    expect(state.video).toBe(true);
    expect(f.calls.length).toBeGreaterThan(callsBefore);
    expect(f.videoTracks).toHaveLength(2);
    expect(onVideoTrack).toHaveBeenCalledWith(f.videoTracks[1]);
    // Первая дорожка осталась остановленной — утечки нет.
    expect(f.videoTracks[0]?.stopped).toBe(true);
  });

  it('★ реализация не использует removeTrack (риск R4)', () => {
    // Страж на уровне ESLint уже есть; здесь фиксируем и на уровне исходника,
    // потому что ренегоциация на каждый клик — дефект, невидимый в UI.
    const source = LocalMedia.prototype.setCameraEnabled.toString();
    expect(source).not.toContain('removeTrack');
  });

  it('отказ при включении камеры не роняет состояние и показывает ошибку', async () => {
    let allow = false;
    const base = fakeDevices();
    const devices = {
      getUserMedia: (constraints: MediaStreamConstraints) =>
        constraints.audio || allow
          ? base.devices.getUserMedia(constraints)
          : Promise.reject(domError('NotReadableError')),
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    } as unknown as MediaDevices;
    const onError = vi.fn();
    const local = new LocalMedia({ mediaDevices: devices, onError });
    await local.acquire();

    expect((await local.setCameraEnabled(true)).video).toBe(false);
    expect(onError).toHaveBeenLastCalledWith('NotReadableError');

    allow = true;
    expect((await local.setCameraEnabled(true)).video).toBe(true);
    expect(onError).toHaveBeenLastCalledWith(null);
  });
});

describe('потеря устройства во время звонка (задача 7.5, ФТ-20)', () => {
  it('★ камеру физически отключили: тумблер off, состояние разослано, баннер', async () => {
    const f = fakeDevices();
    const onStateChange = vi.fn();
    const onError = vi.fn();
    const onVideoTrack = vi.fn();
    const local = new LocalMedia({
      mediaDevices: f.devices,
      onStateChange,
      onError,
      onVideoTrack,
    });
    await local.acquire();
    onStateChange.mockClear();
    onVideoTrack.mockClear();

    f.videoTracks[0]!.end();

    expect(local.state).toEqual({ audio: true, video: false });
    expect(onStateChange).toHaveBeenCalledWith({ audio: true, video: false });
    expect(onError).toHaveBeenLastCalledWith('DeviceLost');
    // Плитка у остальных должна перестать ждать видео.
    expect(onVideoTrack).toHaveBeenCalledWith(null);
  });

  it('микрофон отключили: аудио выключается, участник остаётся в комнате', async () => {
    const f = fakeDevices();
    const local = new LocalMedia({ mediaDevices: f.devices });
    await local.acquire();

    f.audioTracks[0]!.end();

    expect(local.state).toEqual({ audio: false, video: true });
    expect(local.getAudioTrack()).toBeNull();
  });

  it('★ после потери устройство можно включить снова', async () => {
    const f = fakeDevices();
    const local = new LocalMedia({ mediaDevices: f.devices });
    await local.acquire();
    f.videoTracks[0]!.end();

    expect((await local.setCameraEnabled(true)).video).toBe(true);
    expect(f.videoTracks).toHaveLength(2);
  });

  it('подписка на devicechange создаётся и снимается при teardown', async () => {
    const f = fakeDevices();
    const onStateChange = vi.fn();
    const local = new LocalMedia({ mediaDevices: f.devices, onStateChange });
    await local.acquire();
    expect(f.listeners.devicechange).toHaveLength(1);

    onStateChange.mockClear();
    f.fireDeviceChange();
    expect(onStateChange).toHaveBeenCalledTimes(1);

    local.teardown();
    expect(f.listeners.devicechange).toHaveLength(0);
  });
});

describe('teardown (задача 7.6, ФТ-27, риск R7)', () => {
  it('★ останавливает ВСЕ дорожки — иначе камера горит после выхода', async () => {
    const f = fakeDevices();
    const local = new LocalMedia({ mediaDevices: f.devices });
    await local.acquire();

    local.teardown();

    expect(f.audioTracks[0]?.stopped).toBe(true);
    expect(f.videoTracks[0]?.stopped).toBe(true);
    expect(local.getAudioTrack()).toBeNull();
    expect(local.getVideoTrack()).toBeNull();
  });

  it('снимает дорожки с senders до остановки', async () => {
    const f = fakeDevices();
    const onAudioTrack = vi.fn();
    const onVideoTrack = vi.fn();
    const local = new LocalMedia({ mediaDevices: f.devices, onAudioTrack, onVideoTrack });
    await local.acquire();

    local.teardown();

    expect(onVideoTrack).toHaveBeenLastCalledWith(null);
    expect(onAudioTrack).toHaveBeenLastCalledWith(null);
  });

  it('идемпотентен: выход и размонтирование могут случиться подряд', async () => {
    const f = fakeDevices();
    const local = new LocalMedia({ mediaDevices: f.devices });
    await local.acquire();

    local.teardown();
    local.teardown();

    expect(f.videoTracks[0]?.stops).toHaveLength(1);
  });

  it('★ дорожка, полученная после teardown, немедленно останавливается', async () => {
    // Гонка: пользователь ушёл, пока браузер спрашивал разрешение на камеру.
    const pending: { resolve?: (stream: MediaStream) => void } = {};
    const track = new FakeTrack('video');
    const devices = {
      getUserMedia: (constraints: MediaStreamConstraints) => {
        if (constraints.audio) {
          return Promise.resolve(
            new FakeStream([new FakeTrack('audio')]) as unknown as MediaStream,
          );
        }
        return new Promise<MediaStream>((resolve) => {
          pending.resolve = resolve;
        });
      },
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    } as unknown as MediaDevices;
    const local = new LocalMedia({ mediaDevices: devices });

    const acquiring = local.acquire();
    // Ждём, пока запрос камеры реально уйдёт, и только потом уходим из комнаты.
    await vi.waitFor(() => expect(pending.resolve).toBeDefined());
    local.teardown();
    pending.resolve?.(new FakeStream([track]) as unknown as MediaStream);
    await acquiring;

    expect(track.stopped).toBe(true);
  });

  it('после teardown состояние не рассылается', async () => {
    const f = fakeDevices();
    const onStateChange = vi.fn();
    const local = new LocalMedia({ mediaDevices: f.devices, onStateChange });
    await local.acquire();
    local.teardown();
    onStateChange.mockClear();

    f.videoTracks[0]?.end();

    expect(onStateChange).not.toHaveBeenCalled();
  });
});
