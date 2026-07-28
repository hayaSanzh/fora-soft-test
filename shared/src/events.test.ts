/**
 * Тесты контракта (задачи IP 2.1, 2.2).
 *
 * Контракт — это в основном типы, поэтому большая часть проверок здесь
 * компилируется, а не исполняется: файл не пройдёт `tsc`, если форма события
 * или ack разойдётся с TDD §6.2. Плюс несколько runtime-проверок на то, что
 * невозможно выразить типом: полнота списков событий и перечислений ошибок,
 * сужение discriminated union.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  CHAT_ERRORS,
  CLIENT_EVENTS,
  isSystemChatItem,
  isUserChatItem,
  JOIN_ERRORS,
  SERVER_EVENTS,
  type ChatAck,
  type ChatItem,
  type ClientToServerEvents,
  type JoinAck,
  type JoinPayload,
  type Participant,
  type RoomSnapshot,
  type ServerToClientEvents,
  type SocketData,
  type SystemChatItem,
  type UserChatItem,
} from './index.js';

/** Пример из TDD §6.3 — «золотой» образец обмена. */
const PARTICIPANT: Participant = {
  id: 'sV3k_',
  name: 'Алекс',
  media: { audio: true, video: true },
  joinedAt: 1_769_000_000_000,
};

const SNAPSHOT: RoomSnapshot = {
  id: 'V1StGXR8_Z5j',
  participants: [
    {
      id: 'aQ92x',
      name: 'Мария',
      media: { audio: true, video: false },
      joinedAt: 1_768_999_000_000,
    },
    PARTICIPANT,
  ],
  messages: [
    { type: 'system', id: 'm1', kind: 'join', name: 'Мария', ts: 1_768_999_000_000 },
    {
      type: 'user',
      id: 'm2',
      authorId: 'aQ92x',
      authorName: 'Мария',
      text: 'Жду вас',
      ts: 1_768_999_300_000,
    },
  ],
};

describe('события: списки покрывают интерфейсы целиком', () => {
  it('клиент → сервер — 7 событий из TDD §6.2', () => {
    expect([...CLIENT_EVENTS]).toEqual([
      'room:join',
      'room:leave',
      'signal:offer',
      'signal:answer',
      'signal:ice',
      'media:state',
      'chat:message',
    ]);
  });

  it('сервер → клиент — 7 событий из TDD §6.2', () => {
    expect([...SERVER_EVENTS]).toEqual([
      'peer:joined',
      'peer:left',
      'signal:offer',
      'signal:answer',
      'signal:ice',
      'media:state',
      'chat:message',
    ]);
  });

  it('имена событий не пересекаются по смыслу: релей сохраняет имя, presence — нет', () => {
    const both = CLIENT_EVENTS.filter((e) => (SERVER_EVENTS as readonly string[]).includes(e));
    expect(both).toEqual([
      'signal:offer',
      'signal:answer',
      'signal:ice',
      'media:state',
      'chat:message',
    ]);
  });
});

describe('перечисления ошибок (TDD §8.1)', () => {
  it('JoinError покрывает все ошибки ack room:join', () => {
    expect([...JOIN_ERRORS]).toEqual([
      'ROOM_FULL',
      'INVALID_NAME',
      'INVALID_ROOM_ID',
      'ALREADY_JOINED',
    ]);
  });

  it('ChatError покрывает все ошибки ack chat:message', () => {
    expect([...CHAT_ERRORS]).toEqual([
      'EMPTY_TEXT',
      'TEXT_TOO_LONG',
      'RATE_LIMITED',
      'NOT_IN_ROOM',
    ]);
  });
});

describe('ChatItem: discriminated union (ФТ-25)', () => {
  const user: ChatItem = SNAPSHOT.messages[1]!;
  const system: ChatItem = SNAPSHOT.messages[0]!;

  it('сужение по type даёт доступ к специфичным полям', () => {
    expect(isUserChatItem(user)).toBe(true);
    expect(isSystemChatItem(user)).toBe(false);

    if (isUserChatItem(user)) {
      expectTypeOf(user).toEqualTypeOf<UserChatItem>();
      expect(user.authorName).toBe('Мария');
      expect(user.text).toBe('Жду вас');
    }
    if (isSystemChatItem(system)) {
      expectTypeOf(system).toEqualTypeOf<SystemChatItem>();
      expect(system.kind).toBe('join');
    }
  });

  it('системное и пользовательское сообщение лежат в одной истории', () => {
    expect(SNAPSHOT.messages.map((m) => m.type)).toEqual(['system', 'user']);
  });

  it('имя автора хранится в сообщении, а не берётся из списка участников', () => {
    const author = SNAPSHOT.participants.find((p) => p.id === 'aQ92x');
    expect(isUserChatItem(user) && user.authorName).toBe(author?.name);
    // Автор может уйти из комнаты — сообщение остаётся с именем (TDD §8.2).
    const withoutAuthor: RoomSnapshot = { ...SNAPSHOT, participants: [PARTICIPANT] };
    expect(isUserChatItem(withoutAuthor.messages[1]!) && withoutAuthor.messages[1]).toMatchObject({
      authorName: 'Мария',
    });
  });
});

describe('ack room:join (TDD §6.2, §6.3)', () => {
  it('успех несёт self и полный снапшот комнаты — один round-trip', () => {
    const ack: JoinAck = { ok: true, self: PARTICIPANT, room: SNAPSHOT };

    expect(ack.ok).toBe(true);
    if (ack.ok) {
      expect(ack.room.participants).toHaveLength(2);
      expect(ack.room.participants.map((p) => p.id)).toContain(ack.self.id);
      expect(ack.room.messages).toHaveLength(2);
    }
  });

  it('отказ несёт только код ошибки, без утечки состояния комнаты', () => {
    const ack: JoinAck = { ok: false, error: 'ROOM_FULL' };

    expect(Object.keys(ack)).toEqual(['ok', 'error']);
    expect(JSON.stringify(ack)).not.toContain('participants');
  });

  it('ack чата возвращает id сообщения либо код ошибки', () => {
    const ok: ChatAck = { ok: true, id: 'm3' };
    const fail: ChatAck = { ok: false, error: 'RATE_LIMITED' };

    expect(ok.ok && ok.id).toBe('m3');
    expect(!fail.ok && fail.error).toBe('RATE_LIMITED');
  });
});

describe('формы событий на уровне типов', () => {
  it('room:join принимает payload и ack-колбэк', () => {
    expectTypeOf<ClientToServerEvents['room:join']>().parameters.toEqualTypeOf<
      [JoinPayload, (result: JoinAck) => void]
    >();
  });

  it('исходящий сигналинг адресуется через to, входящий приходит с from', () => {
    expectTypeOf<ClientToServerEvents['signal:offer']>()
      .parameter(0)
      .toHaveProperty('to')
      .toEqualTypeOf<string>();
    expectTypeOf<ServerToClientEvents['signal:offer']>()
      .parameter(0)
      .toHaveProperty('from')
      .toEqualTypeOf<string>();
  });

  it('media:state от клиента без id, от сервера — с id участника', () => {
    expectTypeOf<ClientToServerEvents['media:state']>().parameter(0).toEqualTypeOf<{
      audio: boolean;
      video: boolean;
    }>();
    expectTypeOf<ServerToClientEvents['media:state']>()
      .parameter(0)
      .toHaveProperty('id')
      .toEqualTypeOf<string>();
  });

  it('room:leave не имеет payload — идемпотентное событие', () => {
    expectTypeOf<ClientToServerEvents['room:leave']>().parameters.toEqualTypeOf<[]>();
  });

  it('socket.data хранит только roomId — источник истины «где сокет»', () => {
    expectTypeOf<SocketData>().toEqualTypeOf<{ roomId?: string }>();
  });
});

describe('совместимость с браузерными типами WebRTC', () => {
  it('SDP и ICE описаны структурно и принимают формы из lib.dom', () => {
    // Значения ниже — ровно то, что отдают `pc.localDescription.toJSON()`
    // и `event.candidate.toJSON()` в браузере.
    const offer = { type: 'offer' as const, sdp: 'v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\n' };
    const candidate = {
      candidate: 'candidate:1 1 UDP 2130706431 192.168.1.5 54321 typ host',
      sdpMid: '0',
      sdpMLineIndex: 0,
      usernameFragment: 'abc1',
    };

    const out: Parameters<ClientToServerEvents['signal:offer']>[0] = { to: 'peer-1', sdp: offer };
    const ice: Parameters<ClientToServerEvents['signal:ice']>[0] = { to: 'peer-1', candidate };

    expect(out.sdp.type).toBe('offer');
    expect(ice.candidate.sdpMLineIndex).toBe(0);
  });
});
