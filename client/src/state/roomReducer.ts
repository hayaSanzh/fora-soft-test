/**
 * Состояние комнаты и машина состояний экрана (задача IP 5.5, TDD §3.3, §5.4).
 *
 * Ключевое свойство, ради которого reducer вынесен в отдельный тестируемый
 * модуль: **ошибка медиа не может быть терминальной.** Отказ в доступе к
 * камере/микрофону (ФТ-33) переводит экран в `connecting`, а не в экран ошибки:
 * пользователь входит в комнату с выключенными устройствами и остаётся в ней.
 *
 * Терминальна только ошибка сокета: без сигналинга нет ни presence, ни чата
 * (TDD §8.3).
 *
 * `MediaStream` и `RTCPeerConnection` здесь **не хранятся** — они живут в
 * `useRef` внутри `useRoomSession` (задача 9.2), иначе каждое изменение дорожки
 * вызывало бы ре-рендер видеосетки.
 */
import type { ChatItem, MediaState, Participant } from '@video-chat/shared';

/** Экраны из TDD §3.3. */
export type Screen =
  | 'checkingSupport'
  | 'unsupported'
  | 'idle'
  | 'acquiringMedia'
  | 'connecting'
  | 'inRoom'
  | 'roomFull'
  | 'serverError'
  | 'left';

/** Коды ошибок медиа (TDD §8.1). Не терминальны ни в одном из состояний. */
export type MediaErrorKind =
  | 'NotAllowedError'
  | 'NotFoundError'
  | 'NotReadableError'
  | 'OverconstrainedError'
  | 'DeviceLost'
  | 'Unknown';

export type UnsupportedKind = 'WEBRTC_UNSUPPORTED' | 'INSECURE_CONTEXT';

export interface RoomState {
  screen: Screen;
  /** Причина несовместимости — нужна, чтобы показать разный текст (ФТ-36). */
  unsupported: UnsupportedKind | null;
  selfId: string | null;
  selfName: string;
  roomId: string | null;
  /** Включая себя: список участников и есть источник для сетки и списка. */
  participants: Record<string, Participant>;
  messages: ChatItem[];
  /** Баннер поверх комнаты; не мешает находиться в звонке (ФТ-33). */
  mediaError: MediaErrorKind | null;
  /** Состояния соединений с пирами для индикации на плитке (Q9, ФТ-34). */
  peerConnectionStates: Record<string, RTCPeerConnectionState>;
  /** Последняя ошибка чата для подсказки у поля ввода (`RATE_LIMITED` и т. п.). */
  chatError: string | null;
}

export type RoomAction =
  | { type: 'SUPPORT_OK' }
  | { type: 'SUPPORT_FAILED'; kind: UnsupportedKind }
  /** Имя прошло валидацию, пользователь нажал «Создать» или «Войти». */
  | { type: 'NAME_SUBMITTED'; name: string; roomId: string }
  /** Медиа получено полностью или частично — вход продолжается всегда. */
  | { type: 'MEDIA_READY' }
  /** ★ Ошибка медиа: экран НЕ становится терминальным. */
  | { type: 'MEDIA_FAILED'; kind: MediaErrorKind }
  | { type: 'MEDIA_ERROR_DISMISSED' }
  | { type: 'JOINED'; selfId: string; participants: Participant[]; messages: ChatItem[] }
  | { type: 'ROOM_FULL' }
  | { type: 'SERVER_ERROR' }
  | { type: 'RETRY_JOIN' }
  | { type: 'BACK_TO_IDLE' }
  | { type: 'LEFT' }
  | { type: 'PEER_JOINED'; participant: Participant }
  | { type: 'PEER_LEFT'; id: string }
  | { type: 'PEER_MEDIA'; id: string; media: MediaState }
  | { type: 'SELF_MEDIA'; media: MediaState }
  | { type: 'PEER_CONNECTION_STATE'; id: string; state: RTCPeerConnectionState }
  | { type: 'CHAT_MESSAGE'; item: ChatItem }
  | { type: 'CHAT_ERROR'; code: string | null };

export const initialRoomState: RoomState = {
  screen: 'checkingSupport',
  unsupported: null,
  selfId: null,
  selfName: '',
  roomId: null,
  participants: {},
  messages: [],
  mediaError: null,
  peerConnectionStates: {},
  chatError: null,
};

/** Сбрасывает всё, что относится к конкретному входу в комнату. */
function resetSession(state: RoomState): RoomState {
  return {
    ...state,
    selfId: null,
    participants: {},
    messages: [],
    peerConnectionStates: {},
    chatError: null,
  };
}

export function roomReducer(state: RoomState, action: RoomAction): RoomState {
  switch (action.type) {
    // ── Проверка окружения (ФТ-36) ────────────────────────────────────────────
    case 'SUPPORT_OK':
      return state.screen === 'checkingSupport' ? { ...state, screen: 'idle' } : state;

    case 'SUPPORT_FAILED':
      // Терминальное состояние: выйти из него нельзя ничем, кроме смены браузера.
      return { ...state, screen: 'unsupported', unsupported: action.kind };

    // ── Вход ──────────────────────────────────────────────────────────────────
    case 'NAME_SUBMITTED':
      if (state.screen !== 'idle' && state.screen !== 'left') return state;
      return {
        ...resetSession(state),
        screen: 'acquiringMedia',
        selfName: action.name,
        roomId: action.roomId,
        mediaError: null,
      };

    case 'MEDIA_READY':
      return state.screen === 'acquiringMedia' ? { ...state, screen: 'connecting' } : state;

    case 'MEDIA_FAILED':
      // ★ Из `acquiringMedia` уходим в `connecting`, а не в экран ошибки:
      // вход в комнату продолжается без устройств (ФТ-14, ФТ-33, US-12).
      return {
        ...state,
        screen: state.screen === 'acquiringMedia' ? 'connecting' : state.screen,
        mediaError: action.kind,
      };

    case 'MEDIA_ERROR_DISMISSED':
      return { ...state, mediaError: null };

    case 'JOINED': {
      const participants: Record<string, Participant> = {};
      for (const p of action.participants) participants[p.id] = p;
      return {
        ...state,
        screen: 'inRoom',
        selfId: action.selfId,
        participants,
        messages: action.messages,
      };
    }

    case 'ROOM_FULL':
      return { ...resetSession(state), screen: 'roomFull' };

    case 'SERVER_ERROR':
      // Единственная терминальная ошибка: без сокета нет ни presence, ни чата.
      return { ...resetSession(state), screen: 'serverError' };

    case 'RETRY_JOIN':
      // «Повторить вход» с экранов `roomFull` / `serverError`: возвращаемся к
      // получению медиа, имя и комната уже известны (ФТ-8, US-5).
      if (state.roomId === null || state.selfName === '') return { ...state, screen: 'idle' };
      return { ...resetSession(state), screen: 'acquiringMedia', mediaError: null };

    case 'LEFT':
      return { ...resetSession(state), screen: 'left' };

    case 'BACK_TO_IDLE':
      return { ...resetSession(state), screen: 'idle', mediaError: null };

    // ── Presence ──────────────────────────────────────────────────────────────
    case 'PEER_JOINED':
      return {
        ...state,
        participants: { ...state.participants, [action.participant.id]: action.participant },
      };

    case 'PEER_LEFT': {
      if (!(action.id in state.participants)) return state;
      const participants = { ...state.participants };
      delete participants[action.id];
      const peerConnectionStates = { ...state.peerConnectionStates };
      delete peerConnectionStates[action.id];
      return { ...state, participants, peerConnectionStates };
    }

    case 'PEER_MEDIA': {
      const participant = state.participants[action.id];
      if (!participant) return state;
      return {
        ...state,
        participants: {
          ...state.participants,
          [action.id]: { ...participant, media: action.media },
        },
      };
    }

    case 'SELF_MEDIA': {
      if (state.selfId === null) return state;
      const self = state.participants[state.selfId];
      if (!self) return state;
      return {
        ...state,
        participants: {
          ...state.participants,
          [state.selfId]: { ...self, media: action.media },
        },
      };
    }

    case 'PEER_CONNECTION_STATE':
      return {
        ...state,
        peerConnectionStates: { ...state.peerConnectionStates, [action.id]: action.state },
      };

    // ── Чат ───────────────────────────────────────────────────────────────────
    case 'CHAT_MESSAGE':
      // Дубли по id отбрасываются: сервер рассылает сообщение всем, включая
      // автора, а повторная доставка не должна дублировать строку в истории.
      if (state.messages.some((m) => m.id === action.item.id)) return state;
      return { ...state, messages: [...state.messages, action.item] };

    case 'CHAT_ERROR':
      return { ...state, chatError: action.code };

    default:
      return state;
  }
}

/** Участники в стабильном порядке: сначала себя, дальше по времени входа. */
export function orderedParticipants(state: RoomState): Participant[] {
  return Object.values(state.participants).sort((a, b) => {
    if (a.id === state.selfId) return -1;
    if (b.id === state.selfId) return 1;
    return a.joinedAt - b.joinedAt;
  });
}
