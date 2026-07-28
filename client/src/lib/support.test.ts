/**
 * Тесты детектора поддержки (задача IP 5.1, ФТ-36, US-13).
 * Окружение передаётся параметром, поэтому браузер для проверки не нужен.
 */
import { describe, expect, it } from 'vitest';
import { detectWebRtcSupport } from './support';

const fullSupport = {
  RTCPeerConnection: function RTCPeerConnection() {},
  isSecureContext: true,
  navigator: { mediaDevices: { getUserMedia: () => undefined } },
};

describe('detectWebRtcSupport', () => {
  it('современный браузер по HTTPS поддерживается', () => {
    expect(detectWebRtcSupport(fullSupport)).toEqual({
      ok: true,
      reason: null,
      details: { rtcPeerConnection: true, getUserMedia: true, secureContext: true },
    });
  });

  it('★ нет RTCPeerConnection → WEBRTC_UNSUPPORTED', () => {
    const result = detectWebRtcSupport({ ...fullSupport, RTCPeerConnection: undefined });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('WEBRTC_UNSUPPORTED');
  });

  it('★ нет getUserMedia → WEBRTC_UNSUPPORTED', () => {
    expect(detectWebRtcSupport({ ...fullSupport, navigator: {} }).reason).toBe(
      'WEBRTC_UNSUPPORTED',
    );
    expect(detectWebRtcSupport({ ...fullSupport, navigator: { mediaDevices: {} } }).reason).toBe(
      'WEBRTC_UNSUPPORTED',
    );
  });

  it('★ API есть, но страница без HTTPS → INSECURE_CONTEXT', () => {
    const result = detectWebRtcSupport({ ...fullSupport, isSecureContext: false });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('INSECURE_CONTEXT');
    expect(result.details.secureContext).toBe(false);
  });

  it('★ регрессия: на insecure origin браузер не отдаёт mediaDevices — это HTTPS, а не старый браузер', () => {
    // Chrome на http://192.168.x.x вообще не создаёт navigator.mediaDevices.
    // Если проверять API раньше secure context, пользователь получит неверное
    // «браузер не поддерживает WebRTC» вместо объяснения про HTTPS (ФТ-36).
    const insecureChrome = {
      RTCPeerConnection: function RTCPeerConnection() {},
      isSecureContext: false,
      navigator: {}, // mediaDevices отсутствует именно из-за insecure origin
    };

    expect(detectWebRtcSupport(insecureChrome).reason).toBe('INSECURE_CONTEXT');
  });

  it('старый браузер по HTTPS — это всё-таки WEBRTC_UNSUPPORTED', () => {
    expect(detectWebRtcSupport({ isSecureContext: true, navigator: {} }).reason).toBe(
      'WEBRTC_UNSUPPORTED',
    );
  });

  it('пустое окружение не роняет детектор', () => {
    expect(detectWebRtcSupport({}).reason).toBe('WEBRTC_UNSUPPORTED');
  });

  it('отсутствие isSecureContext не считается ошибкой при живом API', () => {
    const withoutFlag = { ...fullSupport };
    delete (withoutFlag as { isSecureContext?: boolean }).isSecureContext;

    expect(detectWebRtcSupport(withoutFlag).ok).toBe(true);
  });
});
