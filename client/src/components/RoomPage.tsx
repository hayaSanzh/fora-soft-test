/**
 * Экран комнаты (задачи IP 5.5, 6.2, 9; финальный UI — группа 10).
 *
 * Страница читает `roomId`, запрашивает имя, ведёт состояние по машине TDD §3.3
 * и отдаёт оркестратору всё, что связано с медиа и сигналингом.
 *
 * Оформление намеренно минимальное: сетка 2×2, заглушка-силуэт, иконка
 * перечёркнутого микрофона, панель чата и экраны ошибок в финальном виде —
 * задачи групп 10 и 11. Здесь ровно столько, чтобы звонок был проверяем.
 */
import { useReducer } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { isSystemChatItem, roomIdSchema, validate } from '@video-chat/shared';
import { useRoomSession } from '../hooks/useRoomSession';
import { formatTime } from '../lib/format';
import { clearPendingJoin, readPendingJoin } from '../lib/pendingJoin';
import { checkName } from '../lib/validation';
import {
  initialRoomState,
  orderedParticipants,
  roomReducer,
  type RoomState,
} from '../state/roomReducer';
import { strings } from '../strings';
import { JoinScreen } from './JoinScreen';
import { ParticipantTile } from './ParticipantTile';

/** Текст баннера по коду ошибки медиа (TDD §8.1); финальный вид — задача 11.4. */
function mediaErrorText(kind: NonNullable<RoomState['mediaError']>): string {
  switch (kind) {
    case 'NotAllowedError':
      return strings.errors.mediaNotAllowed;
    case 'NotFoundError':
      return strings.errors.mediaNotFound;
    case 'NotReadableError':
      return strings.errors.mediaNotReadable;
    case 'OverconstrainedError':
      return strings.errors.mediaOverconstrained;
    case 'DeviceLost':
      return strings.errors.mediaDeviceLost;
    default:
      return strings.errors.mediaUnknown;
  }
}

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
  const navigate = useNavigate();
  const [state, dispatch] = useReducer(roomReducer, roomId, initialStateFor);

  const validRoomId = validate(roomIdSchema, roomId);

  const session = useRoomSession({
    // Сессия живёт от запроса устройств до выхода из комнаты.
    enabled:
      validRoomId.ok &&
      (state.screen === 'acquiringMedia' ||
        state.screen === 'connecting' ||
        state.screen === 'inRoom'),
    roomId: validRoomId.ok ? validRoomId.value : '',
    name: state.selfName,
    dispatch,
    onInvalidRoomId: () => {
      clearPendingJoin();
      void navigate('/', { replace: true });
    },
  });

  if (!validRoomId.ok) {
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

  const backToIdle = () => {
    clearPendingJoin();
    dispatch({ type: 'BACK_TO_IDLE' });
  };

  switch (state.screen) {
    case 'idle':
      return (
        <JoinScreen
          mode="join"
          onSubmit={(name) => dispatch({ type: 'NAME_SUBMITTED', name, roomId: validRoomId.value })}
        />
      );

    // ── Экраны ошибок: финальный вид — группа 11 ─────────────────────────────
    case 'roomFull':
      return (
        <main className="screen screen--center">
          <div className="card">
            <h1>{strings.errors.roomFullTitle}</h1>
            <p>{strings.errors.roomFullText}</p>
            <button
              className="button button--primary"
              type="button"
              onClick={() => dispatch({ type: 'RETRY_JOIN' })}
            >
              {strings.errors.roomFullRetry}
            </button>
          </div>
        </main>
      );

    case 'serverError':
      return (
        <main className="screen screen--center">
          <div className="card">
            <h1>{strings.errors.serverErrorTitle}</h1>
            <p>{strings.errors.serverErrorText}</p>
            <button
              className="button button--primary"
              type="button"
              onClick={() => dispatch({ type: 'RETRY_JOIN' })}
            >
              {strings.errors.serverErrorRetry}
            </button>
          </div>
        </main>
      );

    case 'left':
      return (
        <main className="screen screen--center">
          <div className="card">
            <h1>{strings.errors.leftTitle}</h1>
            <p>{strings.errors.leftText}</p>
            <button className="button button--primary" type="button" onClick={backToIdle}>
              {strings.errors.leftBack}
            </button>
          </div>
        </main>
      );

    case 'inRoom': {
      const participants = orderedParticipants(state);
      return (
        <main className="screen">
          <div className="room">
            <h1>{strings.app.title}</h1>
            <p className="muted">
              Комната <code>{validRoomId.value}</code> · {strings.room.participants}:{' '}
              {participants.length}
            </p>

            {/* Раскладка сетки (1 / 2 / 3–4 плитки) — задача 10.3. */}
            <div className="grid">
              {participants.map((participant) => {
                const isSelf = participant.id === state.selfId;
                return (
                  <ParticipantTile
                    key={participant.id}
                    participant={participant}
                    isSelf={isSelf}
                    connectionState={state.peerConnectionStates[participant.id]}
                    attachVideo={
                      isSelf ? session.attachSelfVideo : session.attachPeerVideo(participant.id)
                    }
                  />
                );
              })}
            </div>

            <div className="controls">
              <button className="button" type="button" onClick={session.toggleMic}>
                {session.media.audio ? strings.room.micOn : strings.room.micOff}
              </button>
              <button className="button" type="button" onClick={session.toggleCamera}>
                {session.media.video ? strings.room.cameraOn : strings.room.cameraOff}
              </button>
              <button className="button" type="button" onClick={session.leave}>
                {strings.room.leave}
              </button>
            </div>

            {state.mediaError && (
              <p className="hint hint--error">{mediaErrorText(state.mediaError)}</p>
            )}

            {/* Журнал системных событий: панель чата — задача 10.6. */}
            <h2>События</h2>
            <ul className="events">
              {state.messages.filter(isSystemChatItem).map((item) => (
                <li key={item.id}>
                  {formatTime(item.ts)}{' '}
                  {item.kind === 'join'
                    ? strings.system.join(item.name)
                    : item.kind === 'leave'
                      ? strings.system.leave(item.name)
                      : strings.system.shutdown}
                </li>
              ))}
            </ul>
          </div>
        </main>
      );
    }

    default:
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
              Комната <code>{validRoomId.value}</code>, имя <strong>{state.selfName}</strong>.
            </p>
            <button className="button" type="button" onClick={backToIdle}>
              {strings.errors.leftBack}
            </button>
          </div>
        </main>
      );
  }
}
