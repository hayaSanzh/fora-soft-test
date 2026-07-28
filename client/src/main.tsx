/**
 * Bootstrap клиента (задача IP 1.5; каркас).
 *
 * Здесь же, до монтирования App, встанет проверка поддержки WebRTC
 * (`detectWebRtcSupport`, задача 5.1) — она обязана срабатывать раньше, чем
 * React дойдёт до вызова `getUserMedia`, иначе пользователь получит белый экран
 * вместо сообщения о несовместимости (ФТ-36).
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';

const container = document.getElementById('root');
if (!container) throw new Error('Не найден #root в index.html');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
