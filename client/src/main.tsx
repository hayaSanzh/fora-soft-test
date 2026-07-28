/**
 * Bootstrap клиента (задачи IP 1.5, 5.1).
 *
 * ★ Проверка поддержки WebRTC выполняется **до монтирования App** (ФТ-36).
 * Если её отложить внутрь React, пользователь старого браузера получит белый
 * экран после первого же обращения к `RTCPeerConnection`, а не сообщение о
 * несовместимости.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { UnsupportedScreen } from './components/overlays/UnsupportedScreen';
import { detectWebRtcSupport } from './lib/support';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('Не найден #root в index.html');

const support = detectWebRtcSupport();
const root = createRoot(container);

root.render(
  <StrictMode>
    {support.ok ? <App /> : <UnsupportedScreen kind={support.reason ?? 'WEBRTC_UNSUPPORTED'} />}
  </StrictMode>,
);
