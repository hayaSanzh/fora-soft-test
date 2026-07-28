/**
 * Каркас приложения (задача IP 1.5).
 *
 * Роутинг (`/` → JoinScreen, `/:roomId` → RoomPage) добавляет задача 5.3,
 * поэтому пока это заглушка, подтверждающая работоспособность окружения:
 * сборка, монтирование React и раздача статики с одного origin.
 */
import { config } from './config';

export function App() {
  return (
    <main
      style={{
        fontFamily: 'system-ui, sans-serif',
        maxWidth: 720,
        margin: '4rem auto',
        padding: '0 1rem',
        lineHeight: 1.5,
      }}
    >
      <h1>Видеочат-комната</h1>
      <p>Каркас окружения запущен. Экраны появятся начиная с группы 5 плана реализации.</p>
      <p>
        Проверка secure context:{' '}
        <strong>{window.isSecureContext ? 'да' : 'нет — getUserMedia будет недоступен'}</strong>
      </p>
      <p>
        Сигналинг: <code>{config.socketUrl === '' ? 'тот же origin' : config.socketUrl}</code>
      </p>
    </main>
  );
}
