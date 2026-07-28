/**
 * Приёмка клиентской части решений Q5–Q9 (TDD §14.2) — постоянная версия
 * скриптовой проверки из группы 0.
 */
import { describe, expect, it } from 'vitest';
import { config, readClientConfig } from './config';

/** Дефолты проверяются на пустом окружении: тест не зависит от переменных сборки. */
const defaults = readClientConfig({});

describe('client config: дефолты закрытых вопросов', () => {
  it('Q5: потолок битрейта выключен', () => {
    expect(defaults.maxVideoBitrate).toBeNull();
  });

  it('Q9: индикация состояния соединения включена', () => {
    expect(defaults.showConnectionState).toBe(true);
  });

  it('Q7/ФТ-38: лимиты зеркалят серверные', () => {
    expect(defaults.maxMessageLen).toBe(500);
    expect(defaults.maxNameLen).toBe(30);
  });

  it('дефолты не зависят от окружения сборки', () => {
    expect(readClientConfig({})).toEqual(readClientConfig({ SOME_UNRELATED: 'x' }));
  });
});

describe('client config: значения из TDD', () => {
  it('Google STUN без TURN (PRD §7, R1)', () => {
    expect(defaults.iceServers).toEqual([{ urls: 'stun:stun.l.google.com:19302' }]);
  });

  it('iceCandidatePoolSize 2 (§9.3)', () => {
    expect(defaults.iceCandidatePoolSize).toBe(2);
  });

  it('720p через ideal, а не exact — иначе OverconstrainedError (§4.4)', () => {
    expect(defaults.videoConstraints).toEqual({
      width: { ideal: 1280, max: 1280 },
      height: { ideal: 720, max: 720 },
      frameRate: { ideal: 24, max: 30 },
    });
    expect(JSON.stringify(defaults.videoConstraints)).not.toContain('exact');
  });

  it('socketUrl пуст → тот же origin, что и страница (§12.1)', () => {
    expect(defaults.socketUrl).toBe('');
    expect(defaults.socketTimeoutMs).toBe(8_000);
  });

  it('roomId длиной 12 символов ≈ 71 бит (§5.3, §10.1)', () => {
    expect(defaults.roomIdLength).toBe(12);
  });

  it('порог автопрокрутки чата 50 px (§7.5)', () => {
    expect(defaults.autoScrollThresholdPx).toBe(50);
  });
});

describe('client config: экспортируемый экземпляр', () => {
  it('собран из переменных сборки', () => {
    expect(config).toEqual(readClientConfig());
  });
});

describe('client config: переопределение через VITE_* (§12.5)', () => {
  it('Q5: VITE_MAX_VIDEO_BITRATE включает потолок битрейта', () => {
    expect(readClientConfig({ VITE_MAX_VIDEO_BITRATE: '800000' }).maxVideoBitrate).toBe(800_000);
  });

  it('Q9: индикацию соединения можно выключить', () => {
    expect(readClientConfig({ VITE_SHOW_CONNECTION_STATE: 'false' }).showConnectionState).toBe(
      false,
    );
    expect(readClientConfig({ VITE_SHOW_CONNECTION_STATE: '0' }).showConnectionState).toBe(false);
  });

  it('★ R1: TURN подставляется конфигурацией, без правки кода', () => {
    const c = readClientConfig({
      VITE_ICE_SERVERS: 'turn:turn.example:3478, stun:stun.l.google.com:19302',
    });

    expect(c.iceServers).toEqual([
      { urls: ['turn:turn.example:3478', 'stun:stun.l.google.com:19302'] },
    ]);
  });

  it('принимает и JSON-форму RTCIceServer[] с учётными данными TURN', () => {
    const c = readClientConfig({
      VITE_ICE_SERVERS: '[{"urls":"turn:t.example:3478","username":"u","credential":"p"}]',
    });

    expect(c.iceServers).toEqual([{ urls: 'turn:t.example:3478', username: 'u', credential: 'p' }]);
  });

  it('битый JSON не роняет старт приложения, а откатывается к STUN', () => {
    const c = readClientConfig({ VITE_ICE_SERVERS: '[{"urls": сломано' });
    expect(c.iceServers).toEqual([{ urls: 'stun:stun.l.google.com:19302' }]);
  });

  it('пустой и мусорный VITE_MAX_VIDEO_BITRATE оставляет потолок выключенным', () => {
    expect(readClientConfig({ VITE_MAX_VIDEO_BITRATE: '' }).maxVideoBitrate).toBeNull();
    expect(readClientConfig({ VITE_MAX_VIDEO_BITRATE: 'много' }).maxVideoBitrate).toBeNull();
  });

  it('неуказанные флаги остаются дефолтными', () => {
    const c = readClientConfig({ VITE_MAX_MESSAGE_LEN: '1000' });

    expect(c.maxMessageLen).toBe(1_000);
    expect(c.iceCandidatePoolSize).toBe(2);
    expect(c.showConnectionState).toBe(true);
  });

  it('переопределяет адрес сигналинга', () => {
    expect(readClientConfig({ VITE_SOCKET_URL: 'https://chat.example' }).socketUrl).toBe(
      'https://chat.example',
    );
  });
});
