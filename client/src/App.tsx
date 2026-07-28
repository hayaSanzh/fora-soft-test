/**
 * Роутинг приложения (задача IP 5.3, ФТ-2, ФТ-4, US-2, US-4).
 *
 * `/` — стартовый экран, `/:roomId` — комната. Идентификатор комнаты
 * генерируется **на клиенте** (`nanoid(12)`): это избавляет от лишнего
 * HTTP-запроса перед входом, а коллизия — штатное поведение по ФТ-6 (участник
 * просто попадёт в существующую комнату).
 *
 * SPA-fallback на сервере (задача 1.3) обязателен: без него прямой переход по
 * ссылке-приглашению `/:roomId` вернул бы 404.
 */
import { nanoid } from 'nanoid';
import { BrowserRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { config } from './config';
import { JoinScreen } from './components/JoinScreen';
import { RoomPage } from './components/RoomPage';
import { setPendingJoin } from './lib/pendingJoin';

/** Стартовый экран: имя → новая комната → переход на её URL. */
function CreateRoomScreen() {
  const navigate = useNavigate();

  return (
    <JoinScreen
      mode="create"
      onSubmit={(name) => {
        const roomId = nanoid(config.roomIdLength);
        // Имя передаётся в памяти модуля: в URL ему не место (ссылкой делятся),
        // web storage запрещён PRD §5, а состояние навигации react-router
        // переживает перезагрузку и нарушило бы ФТ-28 (см. `pendingJoin.ts`).
        setPendingJoin(roomId, name);
        void navigate(`/${roomId}`);
      }}
    />
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<CreateRoomScreen />} />
        <Route path="/:roomId" element={<RoomPage />} />
        {/* Любой другой путь ведёт на стартовый экран: «комнаты не найдено» как
            состояния не существует (ФТ-5), а вложенных маршрутов у нас нет. */}
        <Route path="*" element={<CreateRoomScreen />} />
      </Routes>
    </BrowserRouter>
  );
}
