/**
 * Экран комнаты: композиция и машина состояний (задача IP 5.5; UI — группа 10).
 *
 * На этом шаге страница делает три вещи:
 * 1. читает `roomId` из URL и валидирует его формат (ФТ-4, TDD §5.3);
 * 2. запрашивает имя через тот же `JoinScreen` — ссылка-приглашение ведёт на
 *    экран комнаты «после запроса имени» (PRD §6);
 * 3. проводит состояние по машине из TDD §3.3.
 *
 * Подключение к сокету (группа 6), медиа (группа 7) и сетка плиток (группа 10)
 * встают на готовые переходы: `MEDIA_READY` / `MEDIA_FAILED` / `JOINED` /
 * `ROOM_FULL` / `SERVER_ERROR` уже реализованы и покрыты тестами.
 */
import { useReducer } from 'react';
import { Link, useParams } from 'react-router-dom';
import { roomIdSchema, validate } from '@video-chat/shared';
import { clearPendingJoin, readPendingJoin } from '../lib/pendingJoin';
import { checkName } from '../lib/validation';
import { initialRoomState, roomReducer, type RoomState } from '../state/roomReducer';
import { strings } from '../strings';
import { JoinScreen } from './JoinScreen';

/**
 * Имя приходит из памяти модуля (см. `pendingJoin.ts`) — тогда спрашивать его
 * второй раз не нужно. Перезагрузка страницы обнуляет модуль, и имя
 * запрашивается снова: ровно требование ФТ-28.
 */
function initialStateFor(roomId: string): RoomState {
  const base: RoomState = { ...initialRoomState, screen: 'idle', roomId };
  const pendingName = readPendingJoin(roomId);
  if (pendingName === null) return base;

  const check = checkName(pendingName);
  if (!check.ok) return base;
  return { ...base, screen: 'acquiringMedia', selfName: check.value };
}

export function RoomPage() {
  const { roomId = '' } = useParams();
  // Поддержка уже проверена в `main.tsx` до монтирования, поэтому стартуем с idle.
  const [state, dispatch] = useReducer(roomReducer, roomId, initialStateFor);

  const validRoomId = validate(roomIdSchema, roomId);
  if (!validRoomId.ok) {
    // Мусорная ссылка: показываем объяснение и путь назад, а не пустой экран.
    return (
      <main className="screen screen--center">
        <div className="card">
          <h1>{strings.errors.invalidLinkTitle}</h1>
          <p>{strings.errors.invalidLinkText}</p>
          <Link className="button" to="/">
            {strings.join.createButton}
          </Link>
        </div>
      </main>
    );
  }

  if (state.screen === 'idle') {
    return (
      <JoinScreen
        mode="join"
        onSubmit={(name) => dispatch({ type: 'NAME_SUBMITTED', name, roomId: validRoomId.value })}
      />
    );
  }

  // Заглушка на время групп 6–10: показывает фактическое состояние машины,
  // чтобы переходы были видны в браузере уже сейчас.
  return (
    <main className="screen screen--center">
      <div className="card">
        <h1>{strings.app.title}</h1>
        <p aria-live="polite">
          {state.screen === 'acquiringMedia'
            ? strings.room.acquiringMedia
            : strings.room.connecting}
        </p>
        <p className="muted">
          Комната <code>{validRoomId.value}</code>, имя <strong>{state.selfName}</strong>. Медиа и
          сигналинг подключаются в группах 6–9 плана реализации.
        </p>
        <button
          className="button"
          type="button"
          onClick={() => {
            // Возврат к вводу имени должен именно забыть имя, иначе следующий
            // рендер снова подхватит его из памяти модуля.
            clearPendingJoin();
            dispatch({ type: 'BACK_TO_IDLE' });
          }}
        >
          {strings.errors.leftBack}
        </button>
      </div>
    </main>
  );
}
