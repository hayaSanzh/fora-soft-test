/**
 * Экран комнаты: композиция и машина состояний (задачи IP 5.5, 6.2; UI — группа 10).
 *
 * Что делает страница сейчас:
 * 1. читает `roomId` из URL и валидирует его формат (ФТ-4, TDD §5.3);
 * 2. запрашивает имя, если его нет (PRD §6);
 * 3. проводит состояние по машине TDD §3.3 и подключается к сигналингу.
 *
 * Чего ещё нет: медиа (группа 7), mesh (группы 8–9), сетка плиток и чат
 * (группа 10), экраны ошибок в финальном виде (группа 11).
 */
import { useCallback, useEffect, useReducer, useRef } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { roomIdSchema, validate } from '@video-chat/shared';
import { useLocalMedia } from '../hooks/useLocalMedia';
import { useRoomConnection } from '../hooks/useRoomConnection';
import { clearPendingJoin, readPendingJoin } from '../lib/pendingJoin';
import { checkName } from '../lib/validation';
import { isSystemChatItem, type MediaState, type Participant } from '@video-chat/shared';
import { formatTime } from '../lib/format';
import {
  initialRoomState,
  orderedParticipants,
  roomReducer,
  type RoomState,
} from '../state/roomReducer';
import { strings } from '../strings';
import { JoinScreen } from './JoinScreen';

/**
 * Подпись участника в списке: имя, пометка «вы» и состояние устройств.
 *
 * Состояние берётся из `media:state` (TDD §4.4) — по WebRTC достоверно узнать
 * «камера выключена» нельзя. Вынесено чистой функцией, потому что именно здесь
 * на ручной приёмке не хватало пометок, а проверить это без jsdom иначе нечем.
 * Финальный вид — оверлеи плитки, задача 10.2.
 */
export function describeParticipant(participant: Participant, isSelf: boolean): string {
  const parts = [participant.name];
  if (isSelf) parts.push(`(${strings.room.you})`);
  if (!participant.media.audio) parts.push(`· ${strings.a11y.micMuted}`);
  if (!participant.media.video) parts.push(`· ${strings.a11y.noVideo}`);
  return parts.join(' ');
}

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
  // Поддержка уже проверена в `main.tsx` до монтирования, поэтому стартуем с idle.
  const [state, dispatch] = useReducer(roomReducer, roomId, initialStateFor);

  const validRoomId = validate(roomIdSchema, roomId);

  const selfVideoRef = useRef<HTMLVideoElement | null>(null);
  /** Текущая локальная видеодорожка. В состоянии React её держать нельзя (§9.3). */
  const selfTrackRef = useRef<MediaStreamTrack | null>(null);
  const connectionRef = useRef<{ setMediaState: (media: MediaState) => void } | null>(null);

  /**
   * ★ Присвоение `srcObject` обязано происходить в двух случаях: когда пришла
   * дорожка и когда **смонтировался элемент**. Дорожка приходит на экране
   * `acquiringMedia`, где `<video>` ещё не отрендерен, поэтому одного
   * `onVideoTrack` недостаточно — иначе self-view остаётся чёрным до первого
   * переключения камеры (дефект найден на ручной приёмке группы 7).
   */
  const applySelfTrack = (element: HTMLVideoElement | null): void => {
    if (!element) return;
    const track = selfTrackRef.current;
    element.srcObject = track ? new MediaStream([track]) : null;
  };

  /** Callback-ref: срабатывает в момент появления элемента в DOM. */
  const attachSelfVideo = useCallback((element: HTMLVideoElement | null) => {
    selfVideoRef.current = element;
    applySelfTrack(element);
    // Колбэк стабилен: `applySelfTrack` читает только ref-ы.
  }, []);

  /**
   * Локальные дорожки (группа 7). Запрашиваются на экране `acquiringMedia`;
   * отказ в доступе **не** мешает войти — участник просто войдёт без устройств
   * (ФТ-14, ФТ-33), поэтому обе ветки ведут в `connecting`.
   */
  const localMedia = useLocalMedia({
    enabled: state.screen !== 'idle',
    onAcquired: (acquired, error) => {
      if (error) dispatch({ type: 'MEDIA_FAILED', kind: error });
      else dispatch({ type: 'MEDIA_READY' });
      void acquired;
    },
    onStateChange: (next) => {
      // Своё состояние — в reducer (для self-view) и остальным участникам (ФТ-15…18).
      dispatch({ type: 'SELF_MEDIA', media: next });
      connectionRef.current?.setMediaState(next);
    },
    onVideoTrack: (track) => {
      // Дорожки не проходят через состояние React: иначе видео мигает на каждое
      // изменение (TDD §4.6, §9.3). Элемент может быть ещё не смонтирован —
      // тогда дорожку подхватит `attachSelfVideo`.
      selfTrackRef.current = track;
      applySelfTrack(selfVideoRef.current);
    },
  });

  const connection = useRoomConnection({
    enabled: state.screen === 'connecting' || state.screen === 'inRoom',
    roomId: validRoomId.ok ? validRoomId.value : '',
    name: state.selfName,
    media: localMedia.media,
    dispatch,
    teardownMedia: localMedia.teardown,
    onInvalidRoomId: () => {
      clearPendingJoin();
      void navigate('/', { replace: true });
    },
  });
  const { leave } = connection;
  // Мутировать ref во время рендера нельзя: при прерванном рендере значение
  // могло бы «протечь». Эффект выполняется после коммита, до любых кликов.
  useEffect(() => {
    connectionRef.current = connection;
  });

  // Ошибка медиа показывается баннером; финальный вид — задача 11.4.
  useEffect(() => {
    if (localMedia.error) dispatch({ type: 'MEDIA_FAILED', kind: localMedia.error });
  }, [localMedia.error]);

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

  const backToIdle = () => {
    // Возврат к вводу имени должен именно забыть имя, иначе следующий рендер
    // снова подхватит его из памяти модуля.
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
      // Временное представление комнаты: сетка плиток — задача 10.3,
      // список участников — 10.8, чат — 10.6. Здесь ровно столько, сколько
      // нужно, чтобы presence был проверяем вручную уже сейчас.
      const participants = orderedParticipants(state);
      return (
        <main className="screen screen--center">
          <div className="card">
            <h1>{strings.app.title}</h1>
            <p className="muted">
              Комната <code>{validRoomId.value}</code>
            </p>
            <h2>
              {strings.room.participants} ({participants.length})
            </h2>
            <ul>
              {participants.map((participant) => (
                <li key={participant.id}>
                  {describeParticipant(participant, participant.id === state.selfId)}
                </li>
              ))}
            </ul>
            {/* Временный журнал системных событий: подтверждает ФТ-25 до
                появления панели чата (задача 10.6). */}
            <h2>События</h2>
            <ul>
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
            {/* ★ Self-view. Элемент смонтирован всегда: условный рендеринг
                <video> убивает медиа при выключенной камере (риск R5).
                Финальный вид — VideoTile, задача 10.1. `muted` обязателен,
                иначе гарантированное эхо (ФТ-18, TDD §4.7). */}
            <video
              ref={attachSelfVideo}
              className="self-view"
              autoPlay
              playsInline
              muted
              aria-label={strings.room.you}
            />
            {!localMedia.media.video && <p className="muted">{strings.a11y.noVideo}</p>}
            {/* Временные тумблеры: финальный вид — Controls, задача 10.4. */}
            <div className="controls">
              <button className="button" type="button" onClick={localMedia.toggleMic}>
                {localMedia.media.audio ? strings.room.micOn : strings.room.micOff}
              </button>
              <button className="button" type="button" onClick={localMedia.toggleCamera}>
                {localMedia.media.video ? strings.room.cameraOn : strings.room.cameraOff}
              </button>
            </div>
            {state.mediaError && (
              <p className="hint hint--error">{mediaErrorText(state.mediaError)}</p>
            )}
            <p className="muted">Сетка плиток и чат подключаются в группах 8–10.</p>
            <button className="button" type="button" onClick={leave}>
              {strings.room.leave}
            </button>
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
