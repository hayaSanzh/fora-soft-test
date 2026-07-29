/**
 * Экран комнаты (задачи IP 5.5, 6.2, 9, 10; экраны ошибок — группа 11).
 *
 * Страница читает `roomId`, запрашивает имя, ведёт состояние по машине TDD §3.3
 * и отдаёт оркестратору всё, что связано с медиа и сигналингом.
 *
 * ★ Каждому состоянию машины соответствует свой компонент из `overlays/`:
 * требование PRD — пользователь никогда не должен упираться в белый экран.
 * `default` в `switch` намеренно не используется как «свалка»: разбираются все
 * состояния, а недостижимые здесь (`checkingSupport`, `unsupported`) обработаны
 * до монтирования App в `main.tsx`.
 */
import { useReducer } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { roomIdSchema, validate } from '@video-chat/shared';
import { useRoomSession } from '../hooks/useRoomSession';
import { clearPendingJoin, readPendingJoin } from '../lib/pendingJoin';
import { checkName } from '../lib/validation';
import {
  initialRoomState,
  orderedParticipants,
  roomReducer,
  type RoomState,
} from '../state/roomReducer';
import { strings } from '../strings';
import { ChatPanel } from './ChatPanel';
import { Controls } from './Controls';
import { JoinScreen } from './JoinScreen';
import { ParticipantList } from './ParticipantList';
import { VideoGrid } from './VideoGrid';
import { InvalidLinkScreen } from './overlays/InvalidLinkScreen';
import { LeftScreen } from './overlays/LeftScreen';
import { MediaErrorBanner } from './overlays/MediaErrorBanner';
import { RoomFullScreen } from './overlays/RoomFullScreen';
import { ServerErrorScreen } from './overlays/ServerErrorScreen';
import { StatusScreen } from './overlays/StatusScreen';
import { UnmuteAudioGate } from './overlays/UnmuteAudioGate';
import { UnsupportedScreen } from './overlays/UnsupportedScreen';

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

  if (!validRoomId.ok) return <InvalidLinkScreen />;

  const backToIdle = () => {
    clearPendingJoin();
    dispatch({ type: 'BACK_TO_IDLE' });
  };
  const dismissMediaError = () => dispatch({ type: 'MEDIA_ERROR_DISMISSED' });

  switch (state.screen) {
    case 'idle':
      return (
        <JoinScreen
          mode="join"
          onSubmit={(name) => dispatch({ type: 'NAME_SUBMITTED', name, roomId: validRoomId.value })}
        />
      );

    // ── Экраны ошибок (задачи 11.1–11.3) ─────────────────────────────────────
    case 'roomFull':
      return <RoomFullScreen onRetry={() => dispatch({ type: 'RETRY_JOIN' })} />;

    case 'serverError':
      return <ServerErrorScreen onRetry={() => dispatch({ type: 'RETRY_JOIN' })} />;

    case 'left':
      return <LeftScreen onBack={backToIdle} />;

    /*
     * Оба состояния недостижимы на этом маршруте: проверка окружения выполняется
     * до монтирования App (`main.tsx`, ФТ-36). Разобраны ради полноты — иначе
     * они провалились бы в экран ожидания и показали «Подключаемся…».
     */
    case 'checkingSupport':
      return (
        <StatusScreen
          phase="connecting"
          roomId={validRoomId.value}
          name={state.selfName}
          mediaError={null}
          media={session.media}
          onDismissMediaError={dismissMediaError}
          onCancel={backToIdle}
        />
      );

    case 'unsupported':
      return <UnsupportedScreen kind={state.unsupported ?? 'WEBRTC_UNSUPPORTED'} />;

    case 'inRoom': {
      const participants = orderedParticipants(state);
      return (
        <main className="screen">
          <div className="room">
            <header className="room__header">
              <h1 className="room__title">{strings.app.title}</h1>
              <p className="muted">
                Комната <code>{validRoomId.value}</code>
              </p>
            </header>

            <div className="room__stage">
              {/*
               * ★ Оверлей автозапуска накрывает ТОЛЬКО сетку, поэтому у него
               * отдельная рамка. Накрой он всю сцену — перехватил бы клики по
               * «Выйти» и тумблерам, то есть подсказка про звук заперла бы
               * пользователя в комнате (задача 11.5).
               */}
              <div className="stage__video">
                {/* Сетка 1 / 2 / 3–4 плитки (задача 10.3, ФТ-11). */}
                <VideoGrid
                  participants={participants}
                  selfId={state.selfId}
                  peerConnectionStates={state.peerConnectionStates}
                  attachVideo={session.attachVideo}
                />

                {session.audioBlocked && <UnmuteAudioGate onEnable={session.enableAudio} />}
              </div>

              <Controls
                media={session.media}
                onToggleMic={session.toggleMic}
                onToggleCamera={session.toggleCamera}
                onLeave={session.leave}
              />

              {/* Баннер медиа: пользователь остаётся в комнате (ФТ-33, US-12). */}
              {state.mediaError && (
                <MediaErrorBanner
                  kind={state.mediaError}
                  // Текст уточняется по фактическому состоянию: при отказе только
                  // в камере писать «вас не слышно» неверно.
                  media={session.media}
                  onDismiss={dismissMediaError}
                />
              )}
            </div>

            <aside className="room__side">
              <ParticipantList participants={participants} selfId={state.selfId} />
              <ChatPanel
                messages={state.messages}
                chatError={state.chatError}
                onSend={session.sendChatMessage}
              />
            </aside>
          </div>
        </main>
      );
    }

    case 'acquiringMedia':
    case 'connecting':
      return (
        <StatusScreen
          phase={state.screen}
          roomId={validRoomId.value}
          name={state.selfName}
          mediaError={state.mediaError}
          media={session.media}
          onDismissMediaError={dismissMediaError}
          onCancel={backToIdle}
        />
      );
  }
}
