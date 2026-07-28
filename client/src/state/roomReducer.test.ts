/**
 * Тесты машины состояний экрана (задача IP 5.5, TDD §3.3, §5.4).
 *
 * Главное утверждение файла: **ошибка медиа не может быть терминальной**
 * (ФТ-14, ФТ-33, US-12). Терминальна только ошибка сокета — без сигналинга нет
 * ни presence, ни чата (TDD §8.3).
 */
import { describe, expect, it } from 'vitest';
import type { ChatItem, Participant } from '@video-chat/shared';
import {
  initialRoomState,
  orderedParticipants,
  roomReducer,
  type RoomAction,
  type RoomState,
} from './roomReducer';

const ME: Participant = {
  id: 'self-1',
  name: 'Аня',
  media: { audio: true, video: true },
  joinedAt: 1_000,
};
const PEER: Participant = {
  id: 'peer-1',
  name: 'Борис',
  media: { audio: true, video: false },
  joinedAt: 2_000,
};

/** Прогоняет последовательность действий от начального состояния. */
function run(...actions: RoomAction[]): RoomState {
  return actions.reduce(roomReducer, initialRoomState);
}

const enterRoom = (): RoomAction[] => [
  { type: 'SUPPORT_OK' },
  { type: 'NAME_SUBMITTED', name: 'Аня', roomId: 'RoomAAA' },
  { type: 'MEDIA_READY' },
  { type: 'JOINED', selfId: ME.id, participants: [ME], messages: [] },
];

describe('счастливый путь (TDD §3.3)', () => {
  it('checkingSupport → idle → acquiringMedia → connecting → inRoom', () => {
    expect(initialRoomState.screen).toBe('checkingSupport');
    expect(run({ type: 'SUPPORT_OK' }).screen).toBe('idle');
    expect(
      run({ type: 'SUPPORT_OK' }, { type: 'NAME_SUBMITTED', name: 'Аня', roomId: 'RoomAAA' })
        .screen,
    ).toBe('acquiringMedia');
    expect(
      run(
        { type: 'SUPPORT_OK' },
        { type: 'NAME_SUBMITTED', name: 'Аня', roomId: 'RoomAAA' },
        { type: 'MEDIA_READY' },
      ).screen,
    ).toBe('connecting');

    const inRoom = run(...enterRoom());
    expect(inRoom.screen).toBe('inRoom');
    expect(inRoom.selfId).toBe('self-1');
    expect(inRoom.selfName).toBe('Аня');
    expect(inRoom.roomId).toBe('RoomAAA');
  });

  it('имя и комната запоминаются на входе', () => {
    const state = run(
      { type: 'SUPPORT_OK' },
      {
        type: 'NAME_SUBMITTED',
        name: 'Анна-Мария',
        roomId: 'V1StGXR8_Z5j',
      },
    );

    expect(state).toMatchObject({ selfName: 'Анна-Мария', roomId: 'V1StGXR8_Z5j' });
  });
});

describe('★ ошибка медиа не терминальна (ФТ-14, ФТ-33, US-12)', () => {
  it.each([
    'NotAllowedError',
    'NotFoundError',
    'NotReadableError',
    'OverconstrainedError',
    'DeviceLost',
    'Unknown',
  ] as const)('%s из acquiringMedia переводит в connecting, а не в экран ошибки', (kind) => {
    const state = run(
      { type: 'SUPPORT_OK' },
      { type: 'NAME_SUBMITTED', name: 'Аня', roomId: 'RoomAAA' },
      { type: 'MEDIA_FAILED', kind },
    );

    expect(state.screen).toBe('connecting');
    expect(state.mediaError).toBe(kind);
  });

  it('вход завершается успешно даже с ошибкой медиа — пользователь в комнате', () => {
    const state = run(
      { type: 'SUPPORT_OK' },
      { type: 'NAME_SUBMITTED', name: 'Аня', roomId: 'RoomAAA' },
      { type: 'MEDIA_FAILED', kind: 'NotAllowedError' },
      { type: 'JOINED', selfId: ME.id, participants: [ME], messages: [] },
    );

    expect(state.screen).toBe('inRoom');
    // Баннер остаётся: пользователь должен понимать, почему его не видно.
    expect(state.mediaError).toBe('NotAllowedError');
  });

  it('потеря устройства в комнате не выкидывает из неё (ФТ-20)', () => {
    const state = roomReducer(run(...enterRoom()), { type: 'MEDIA_FAILED', kind: 'DeviceLost' });

    expect(state.screen).toBe('inRoom');
    expect(state.mediaError).toBe('DeviceLost');
  });

  it('баннер можно закрыть, оставшись в комнате', () => {
    const withError = roomReducer(run(...enterRoom()), {
      type: 'MEDIA_FAILED',
      kind: 'NotFoundError',
    });

    const dismissed = roomReducer(withError, { type: 'MEDIA_ERROR_DISMISSED' });

    expect(dismissed.screen).toBe('inRoom');
    expect(dismissed.mediaError).toBeNull();
  });
});

describe('терминальные и восстановимые ошибки', () => {
  it('несовместимость браузера — терминальное состояние (ФТ-36)', () => {
    const state = run({ type: 'SUPPORT_FAILED', kind: 'WEBRTC_UNSUPPORTED' });

    expect(state).toMatchObject({ screen: 'unsupported', unsupported: 'WEBRTC_UNSUPPORTED' });
    // Из unsupported ничего не выводит: ни повтор, ни ввод имени.
    expect(roomReducer(state, { type: 'SUPPORT_OK' }).screen).toBe('unsupported');
    expect(
      roomReducer(state, { type: 'NAME_SUBMITTED', name: 'Аня', roomId: 'RoomAAA' }).screen,
    ).toBe('unsupported');
  });

  it('отсутствие HTTPS различается от старого браузера — разный текст', () => {
    expect(run({ type: 'SUPPORT_FAILED', kind: 'INSECURE_CONTEXT' }).unsupported).toBe(
      'INSECURE_CONTEXT',
    );
  });

  it('★ ROOM_FULL — экран с рабочим повтором входа (ФТ-8, US-5)', () => {
    const full = roomReducer(
      run(
        { type: 'SUPPORT_OK' },
        { type: 'NAME_SUBMITTED', name: 'Аня', roomId: 'RoomAAA' },
        { type: 'MEDIA_READY' },
      ),
      { type: 'ROOM_FULL' },
    );
    expect(full.screen).toBe('roomFull');

    const retry = roomReducer(full, { type: 'RETRY_JOIN' });

    // Повтор возвращает к получению медиа: имя и комната уже известны.
    expect(retry.screen).toBe('acquiringMedia');
    expect(retry.selfName).toBe('Аня');
    expect(retry.roomId).toBe('RoomAAA');
  });

  it('★ ошибка сокета терминальна для сессии, но повтор возможен (ФТ-35)', () => {
    const failed = roomReducer(run(...enterRoom()), { type: 'SERVER_ERROR' });

    expect(failed.screen).toBe('serverError');
    // Состояние сессии очищено: участники и история не должны «залипнуть».
    expect(failed.participants).toEqual({});
    expect(failed.messages).toEqual([]);
    expect(failed.selfId).toBeNull();

    expect(roomReducer(failed, { type: 'RETRY_JOIN' }).screen).toBe('acquiringMedia');
  });

  it('повтор без имени и комнаты возвращает на стартовый экран', () => {
    const state = roomReducer(
      { ...initialRoomState, screen: 'serverError' },
      {
        type: 'RETRY_JOIN',
      },
    );

    expect(state.screen).toBe('idle');
  });

  it('выход даёт экран «вы вышли», из него можно вернуться (ФТ-27, US-10)', () => {
    const left = roomReducer(run(...enterRoom()), { type: 'LEFT' });

    expect(left.screen).toBe('left');
    expect(left.participants).toEqual({});
    expect(roomReducer(left, { type: 'BACK_TO_IDLE' }).screen).toBe('idle');
    // Со экрана «вы вышли» можно войти снова напрямую.
    expect(
      roomReducer(left, { type: 'NAME_SUBMITTED', name: 'Аня', roomId: 'RoomAAA' }).screen,
    ).toBe('acquiringMedia');
  });
});

describe('недопустимые переходы игнорируются', () => {
  it('MEDIA_READY вне acquiringMedia ничего не меняет', () => {
    const idle = run({ type: 'SUPPORT_OK' });
    expect(roomReducer(idle, { type: 'MEDIA_READY' })).toBe(idle);

    const inRoom = run(...enterRoom());
    expect(roomReducer(inRoom, { type: 'MEDIA_READY' }).screen).toBe('inRoom');
  });

  it('NAME_SUBMITTED из connecting не сбрасывает вход', () => {
    const connecting = run(
      { type: 'SUPPORT_OK' },
      { type: 'NAME_SUBMITTED', name: 'Аня', roomId: 'RoomAAA' },
      { type: 'MEDIA_READY' },
    );

    expect(
      roomReducer(connecting, { type: 'NAME_SUBMITTED', name: 'Хакер', roomId: 'Other' }),
    ).toBe(connecting);
  });

  it('SUPPORT_OK после старта ничего не ломает', () => {
    const inRoom = run(...enterRoom());
    expect(roomReducer(inRoom, { type: 'SUPPORT_OK' })).toBe(inRoom);
  });
});

describe('presence (ФТ-26, ФТ-30)', () => {
  it('вход и выход участника обновляют список', () => {
    const withPeer = roomReducer(run(...enterRoom()), {
      type: 'PEER_JOINED',
      participant: PEER,
    });
    expect(Object.keys(withPeer.participants)).toEqual(['self-1', 'peer-1']);

    const withoutPeer = roomReducer(withPeer, { type: 'PEER_LEFT', id: PEER.id });
    expect(Object.keys(withoutPeer.participants)).toEqual(['self-1']);
  });

  it('выход участника убирает и состояние его соединения', () => {
    const state = [
      { type: 'PEER_JOINED', participant: PEER } as RoomAction,
      { type: 'PEER_CONNECTION_STATE', id: PEER.id, state: 'connected' } as RoomAction,
      { type: 'PEER_LEFT', id: PEER.id } as RoomAction,
    ].reduce(roomReducer, run(...enterRoom()));

    expect(state.peerConnectionStates).toEqual({});
  });

  it('peer:left о неизвестном участнике не меняет состояние', () => {
    const inRoom = run(...enterRoom());
    expect(roomReducer(inRoom, { type: 'PEER_LEFT', id: 'нет-такого' })).toBe(inRoom);
  });

  it('★ media:state участника обновляет только его (источник заглушек ФТ-16/18)', () => {
    const withPeer = roomReducer(run(...enterRoom()), { type: 'PEER_JOINED', participant: PEER });

    const updated = roomReducer(withPeer, {
      type: 'PEER_MEDIA',
      id: PEER.id,
      media: { audio: false, video: true },
    });

    expect(updated.participants[PEER.id]?.media).toEqual({ audio: false, video: true });
    expect(updated.participants[ME.id]?.media).toEqual(ME.media);
  });

  it('своё состояние устройств тоже отражается в списке (self-view)', () => {
    const updated = roomReducer(run(...enterRoom()), {
      type: 'SELF_MEDIA',
      media: { audio: false, video: false },
    });

    expect(updated.participants[ME.id]?.media).toEqual({ audio: false, video: false });
  });

  it('состояние соединения пира хранится для индикации на плитке (Q9, ФТ-34)', () => {
    const state = roomReducer(run(...enterRoom()), {
      type: 'PEER_CONNECTION_STATE',
      id: PEER.id,
      state: 'failed',
    });

    expect(state.peerConnectionStates[PEER.id]).toBe('failed');
  });

  it('orderedParticipants ставит себя первым, остальных по времени входа', () => {
    const later: Participant = { ...PEER, id: 'peer-2', name: 'Вера', joinedAt: 3_000 };
    const state = [
      { type: 'PEER_JOINED', participant: later } as RoomAction,
      { type: 'PEER_JOINED', participant: PEER } as RoomAction,
    ].reduce(roomReducer, run(...enterRoom()));

    expect(orderedParticipants(state).map((p) => p.name)).toEqual(['Аня', 'Борис', 'Вера']);
  });
});

describe('чат (ФТ-23, ФТ-25)', () => {
  const message = (id: string, text: string): ChatItem => ({
    type: 'user',
    id,
    authorId: PEER.id,
    authorName: PEER.name,
    text,
    ts: 1_769_000_000_000,
  });

  it('история из снапшота попадает в состояние при входе (ФТ-23)', () => {
    const state = run(
      { type: 'SUPPORT_OK' },
      { type: 'NAME_SUBMITTED', name: 'Аня', roomId: 'RoomAAA' },
      { type: 'MEDIA_READY' },
      {
        type: 'JOINED',
        selfId: ME.id,
        participants: [ME],
        messages: [message('m1', 'до входа')],
      },
    );

    expect(state.messages).toHaveLength(1);
  });

  it('новые сообщения добавляются в конец', () => {
    const state = [
      { type: 'CHAT_MESSAGE', item: message('m1', 'первое') } as RoomAction,
      { type: 'CHAT_MESSAGE', item: message('m2', 'второе') } as RoomAction,
    ].reduce(roomReducer, run(...enterRoom()));

    expect(state.messages.map((m) => (m.type === 'user' ? m.text : ''))).toEqual([
      'первое',
      'второе',
    ]);
  });

  it('★ повторная доставка одного id не дублирует строку в истории', () => {
    const once = roomReducer(run(...enterRoom()), {
      type: 'CHAT_MESSAGE',
      item: message('m1', 'привет'),
    });

    const twice = roomReducer(once, { type: 'CHAT_MESSAGE', item: message('m1', 'привет') });

    expect(twice.messages).toHaveLength(1);
    expect(twice).toBe(once);
  });

  it('системное сообщение хранится в той же истории (ФТ-25)', () => {
    const state = roomReducer(run(...enterRoom()), {
      type: 'CHAT_MESSAGE',
      item: { type: 'system', id: 's1', kind: 'leave', name: 'Борис', ts: 1 },
    });

    expect(state.messages[0]).toMatchObject({ type: 'system', kind: 'leave' });
  });

  it('ошибка отправки хранится для подсказки у поля ввода и сбрасывается', () => {
    const withError = roomReducer(run(...enterRoom()), {
      type: 'CHAT_ERROR',
      code: 'RATE_LIMITED',
    });
    expect(withError.chatError).toBe('RATE_LIMITED');
    expect(roomReducer(withError, { type: 'CHAT_ERROR', code: null }).chatError).toBeNull();
  });

  it('история и ошибки чата очищаются при выходе', () => {
    const state = [
      { type: 'CHAT_MESSAGE', item: message('m1', 'привет') } as RoomAction,
      { type: 'CHAT_ERROR', code: 'RATE_LIMITED' } as RoomAction,
      { type: 'LEFT' } as RoomAction,
    ].reduce(roomReducer, run(...enterRoom()));

    expect(state.messages).toEqual([]);
    expect(state.chatError).toBeNull();
  });
});
