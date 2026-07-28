/**
 * Тесты жизненного цикла соединения на **живом** socket.io-сервере
 * (задачи IP 6.2, 6.3, ФТ-8, ФТ-31, ФТ-35, TDD §8.1, §8.3).
 *
 * Сервер в тестах минимальный: он отвечает ровно то, что нужно проверить
 * (`ok` / `ROOM_FULL` / `INVALID_ROOM_ID` / молчание). Реальный сервер и его
 * обработчики покрыты integration-тестами группы 4; здесь проверяется
 * **клиентская** сторона: настоящий WebSocket, настоящие ack, настоящие обрывы.
 */
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Server } from 'socket.io';
import {
  SOCKET_PATH,
  type ClientToServerEvents,
  type JoinAck,
  type JoinPayload,
  type Participant,
  type ServerToClientEvents,
} from '@video-chat/shared';
import type { RoomAction } from '../state/roomReducer';
import { startRoomConnection, type RoomConnection } from './roomConnection';
import { createSocket } from './socket';

const SELF: Participant = {
  id: 'self-1',
  name: 'Аня',
  media: { audio: false, video: false },
  joinedAt: 1_769_000_000_000,
};

interface Stub {
  url: string;
  io: Server<ClientToServerEvents, ServerToClientEvents>;
  httpServer: HttpServer;
  /** Payload'ы `room:join`, дошедшие до сервера. */
  joins: JoinPayload[];
  close: () => Promise<void>;
}

const PEER: Participant = {
  id: 'peer-1',
  name: 'Борис',
  media: { audio: true, video: false },
  joinedAt: 1_769_000_001_000,
};

const OK_ACK: JoinAck = {
  ok: true,
  self: SELF,
  room: { id: 'RoomAAA', participants: [SELF], messages: [] },
};

/** Поднимает сервер-заглушку, отвечающий заданным ack (или молчащий). */
async function startStub(reply: JoinAck | 'silence'): Promise<Stub> {
  const httpServer = createServer();
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    path: SOCKET_PATH,
    transports: ['websocket'],
  });
  const joins: JoinPayload[] = [];

  io.on('connection', (socket) => {
    socket.on('room:join', (payload, ack) => {
      joins.push(payload);
      if (reply !== 'silence') ack(reply);
    });
  });

  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const { port } = httpServer.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    io,
    httpServer,
    joins,
    close: async () => {
      await io.close();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}

let stub: Stub | null = null;
let connection: RoomConnection | null = null;

afterEach(async () => {
  connection?.dispose();
  connection = null;
  await stub?.close();
  stub = null;
});

interface Harness {
  actions: RoomAction[];
  onInvalidRoomId: ReturnType<typeof vi.fn>;
  teardownMedia: ReturnType<typeof vi.fn>;
  connection: RoomConnection;
}

function connect(url: string, timeoutMs = 500): Harness {
  const actions: RoomAction[] = [];
  const onInvalidRoomId = vi.fn();
  const teardownMedia = vi.fn();

  const created = startRoomConnection({
    roomId: 'RoomAAA',
    name: 'Аня',
    media: { audio: false, video: false },
    dispatch: (action) => actions.push(action),
    onInvalidRoomId,
    teardownMedia,
    createSocketFn: () => createSocket({ url, timeoutMs }),
    timeoutMs,
  });
  connection = created;

  return { actions, onInvalidRoomId, teardownMedia, connection: created };
}

/** Ждёт появления действия нужного типа. */
async function waitForAction(actions: RoomAction[], type: RoomAction['type'], ms = 4_000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const found = actions.find((a) => a.type === type);
    if (found) return found;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`действие ${type} не пришло; получены: ${actions.map((a) => a.type).join(', ')}`);
}

describe('успешный вход (задача 6.2)', () => {
  it('★ отправляет room:join и переводит экран в inRoom', async () => {
    stub = await startStub({
      ok: true,
      self: SELF,
      room: { id: 'RoomAAA', participants: [SELF], messages: [] },
    });
    const h = connect(stub.url);

    const joined = await waitForAction(h.actions, 'JOINED');

    expect(joined).toEqual({
      type: 'JOINED',
      selfId: 'self-1',
      participants: [SELF],
      messages: [],
    });
    expect(stub.joins).toEqual([
      { roomId: 'RoomAAA', name: 'Аня', media: { audio: false, video: false } },
    ]);
    expect(h.teardownMedia).not.toHaveBeenCalled();
  });

  it('состояние устройств уходит на сервер как есть (ФТ-14: вход без устройств)', async () => {
    stub = await startStub({
      ok: true,
      self: SELF,
      room: { id: 'RoomAAA', participants: [SELF], messages: [] },
    });
    const h = connect(stub.url);

    await waitForAction(h.actions, 'JOINED');

    expect(stub.joins[0]?.media).toEqual({ audio: false, video: false });
  });
});

describe('отказы сервера (задача 6.2, TDD §8.1)', () => {
  it('★ ROOM_FULL → экран «Комната заполнена», соединение закрыто (ФТ-8)', async () => {
    stub = await startStub({ ok: false, error: 'ROOM_FULL' });
    const h = connect(stub.url);

    await waitForAction(h.actions, 'ROOM_FULL');

    // Слот не занят: сокет отпущен, чтобы не висеть в комнате «наблюдателем».
    expect(h.connection.socket.connected).toBe(false);
    // ★ Экран ошибки сервера при этом НЕ показывается: ROOM_FULL — не сбой.
    expect(h.actions.map((a) => a.type)).not.toContain('SERVER_ERROR');
    expect(h.teardownMedia).toHaveBeenCalledTimes(1);
  });

  it('★ INVALID_ROOM_ID → возврат на стартовый экран, без экрана ошибки', async () => {
    stub = await startStub({ ok: false, error: 'INVALID_ROOM_ID' });
    const h = connect(stub.url);

    await vi.waitFor(() => expect(h.onInvalidRoomId).toHaveBeenCalledTimes(1), { timeout: 4_000 });

    expect(h.actions.map((a) => a.type)).not.toContain('SERVER_ERROR');
    expect(h.connection.socket.connected).toBe(false);
  });

  it('INVALID_NAME и ALREADY_JOINED — дефект клиента, показываем экран ошибки', async () => {
    stub = await startStub({ ok: false, error: 'ALREADY_JOINED' });
    const h = connect(stub.url);

    await waitForAction(h.actions, 'SERVER_ERROR');

    expect(h.teardownMedia).toHaveBeenCalled();
  });
});

describe('ошибки транспорта (задача 6.3, ФТ-35)', () => {
  it('★ сервер недоступен → connect_error → экран ошибки сервера', async () => {
    const h = connect('http://127.0.0.1:1');

    await waitForAction(h.actions, 'SERVER_ERROR');

    expect(h.teardownMedia).toHaveBeenCalledTimes(1);
  });

  it('★ сервер молчит на join → таймаут трактуется как ошибка сервера', async () => {
    stub = await startStub('silence');
    const h = connect(stub.url, 300);

    await waitForAction(h.actions, 'SERVER_ERROR');

    expect(stub.joins).toHaveLength(1); // join ушёл, ответа не было
    expect(h.teardownMedia).toHaveBeenCalledTimes(1);
  });

  it('★ обрыв после входа → экран ошибки + полный teardown медиа (риск R7)', async () => {
    stub = await startStub({
      ok: true,
      self: SELF,
      room: { id: 'RoomAAA', participants: [SELF], messages: [] },
    });
    const h = connect(stub.url);
    await waitForAction(h.actions, 'JOINED');

    // Сервер уронил соединение — ровно то, что видит клиент при рестарте сервера.
    stub.io.disconnectSockets(true);

    await waitForAction(h.actions, 'SERVER_ERROR');
    expect(h.teardownMedia).toHaveBeenCalledTimes(1);
  });

  it('★ auto-reconnect не срабатывает: после обрыва клиент не подключается снова (ФТ-31)', async () => {
    stub = await startStub({
      ok: true,
      self: SELF,
      room: { id: 'RoomAAA', participants: [SELF], messages: [] },
    });
    const h = connect(stub.url);
    await waitForAction(h.actions, 'JOINED');
    const joinsBefore = stub.joins.length;

    stub.io.disconnectSockets(true);
    await waitForAction(h.actions, 'SERVER_ERROR');
    await new Promise((r) => setTimeout(r, 600));

    expect(h.connection.socket.connected).toBe(false);
    // Повторных join не было: слот на сервере не занимается фантомом.
    expect(stub.joins).toHaveLength(joinsBefore);
  });

  it('терминальная ошибка обрабатывается один раз, даже при нескольких событиях', async () => {
    stub = await startStub('silence');
    const h = connect(stub.url, 200);

    await waitForAction(h.actions, 'SERVER_ERROR');
    stub.io.disconnectSockets(true);
    await new Promise((r) => setTimeout(r, 300));

    expect(h.actions.filter((a) => a.type === 'SERVER_ERROR')).toHaveLength(1);
    expect(h.teardownMedia).toHaveBeenCalledTimes(1);
  });
});

describe('осознанный выход и размонтирование', () => {
  it('★ leave() сообщает серверу и не показывает экран ошибки', async () => {
    stub = await startStub({
      ok: true,
      self: SELF,
      room: { id: 'RoomAAA', participants: [SELF], messages: [] },
    });
    const leaves: string[] = [];
    stub.io.on('connection', (socket) => socket.on('room:leave', () => leaves.push(socket.id)));
    const h = connect(stub.url);
    await waitForAction(h.actions, 'JOINED');

    h.connection.leave();
    await new Promise((r) => setTimeout(r, 200));

    expect(h.actions.map((a) => a.type)).toContain('LEFT');
    expect(h.actions.map((a) => a.type)).not.toContain('SERVER_ERROR');
    expect(h.teardownMedia).toHaveBeenCalledTimes(1);
    expect(h.connection.socket.connected).toBe(false);
  });

  it('dispose() освобождает медиа и не порождает экран ошибки', async () => {
    stub = await startStub({
      ok: true,
      self: SELF,
      room: { id: 'RoomAAA', participants: [SELF], messages: [] },
    });
    const h = connect(stub.url);
    await waitForAction(h.actions, 'JOINED');

    h.connection.dispose();
    await new Promise((r) => setTimeout(r, 200));

    expect(h.teardownMedia).toHaveBeenCalledTimes(1);
    expect(h.actions.map((a) => a.type)).not.toContain('SERVER_ERROR');
  });

  it('повторные leave() и dispose() идемпотентны', async () => {
    stub = await startStub({
      ok: true,
      self: SELF,
      room: { id: 'RoomAAA', participants: [SELF], messages: [] },
    });
    const h = connect(stub.url);
    await waitForAction(h.actions, 'JOINED');

    h.connection.leave();
    h.connection.leave();
    h.connection.dispose();

    expect(h.teardownMedia).toHaveBeenCalledTimes(1);
    expect(h.actions.filter((a) => a.type === 'LEFT')).toHaveLength(1);
  });
});

describe('★ presence и чат: подписки на события комнаты (ФТ-25…27, ФТ-31, веха M1)', () => {
  it('★ peer:joined добавляет участника в список — иначе комната «мертва»', async () => {
    stub = await startStub(OK_ACK);
    const h = connect(stub.url);
    await waitForAction(h.actions, 'JOINED');

    stub.io.emit('peer:joined', { participant: PEER });

    const action = await waitForAction(h.actions, 'PEER_JOINED');
    expect(action).toEqual({ type: 'PEER_JOINED', participant: PEER });
  });

  it('★ peer:left убирает участника (ФТ-27, ФТ-31)', async () => {
    stub = await startStub(OK_ACK);
    const h = connect(stub.url);
    await waitForAction(h.actions, 'JOINED');

    stub.io.emit('peer:left', { id: PEER.id, name: PEER.name });

    expect(await waitForAction(h.actions, 'PEER_LEFT')).toEqual({
      type: 'PEER_LEFT',
      id: 'peer-1',
    });
  });

  it('★ media:state участника доезжает — источник заглушки камеры (ФТ-16, ФТ-18)', async () => {
    stub = await startStub(OK_ACK);
    const h = connect(stub.url);
    await waitForAction(h.actions, 'JOINED');

    stub.io.emit('media:state', { id: PEER.id, media: { audio: false, video: true } });

    expect(await waitForAction(h.actions, 'PEER_MEDIA')).toEqual({
      type: 'PEER_MEDIA',
      id: 'peer-1',
      media: { audio: false, video: true },
    });
  });

  it('★ системные и пользовательские сообщения попадают в историю (ФТ-21, ФТ-25)', async () => {
    stub = await startStub(OK_ACK);
    const h = connect(stub.url);
    await waitForAction(h.actions, 'JOINED');

    stub.io.emit('chat:message', {
      type: 'system',
      id: 's1',
      kind: 'leave',
      name: 'Борис',
      ts: 1,
    });
    stub.io.emit('chat:message', {
      type: 'user',
      id: 'm1',
      authorId: PEER.id,
      authorName: PEER.name,
      text: 'привет',
      ts: 2,
    });

    await vi.waitFor(
      () => expect(h.actions.filter((a) => a.type === 'CHAT_MESSAGE')).toHaveLength(2),
      { timeout: 4_000 },
    );
  });

  it('★ колбэки для группы 9 вызываются вместе с обновлением состояния', async () => {
    stub = await startStub(OK_ACK);
    const onPeerJoined = vi.fn();
    const onPeerLeft = vi.fn();
    const actions: RoomAction[] = [];
    connection = startRoomConnection({
      roomId: 'RoomAAA',
      name: 'Аня',
      media: { audio: false, video: false },
      dispatch: (action) => actions.push(action),
      onInvalidRoomId: () => undefined,
      onPeerJoined,
      onPeerLeft,
      createSocketFn: () => createSocket({ url: stub!.url, timeoutMs: 500 }),
      timeoutMs: 500,
    });
    await waitForAction(actions, 'JOINED');

    stub.io.emit('peer:joined', { participant: PEER });
    stub.io.emit('peer:left', { id: PEER.id, name: PEER.name });

    await vi.waitFor(
      () => {
        expect(onPeerJoined).toHaveBeenCalledWith(PEER);
        expect(onPeerLeft).toHaveBeenCalledWith(PEER.id);
      },
      { timeout: 4_000 },
    );
  });

  it('после teardown события комнаты больше не обрабатываются', async () => {
    stub = await startStub(OK_ACK);
    const h = connect(stub.url);
    await waitForAction(h.actions, 'JOINED');

    h.connection.dispose();
    stub.io.emit('peer:joined', { participant: PEER });
    await new Promise((r) => setTimeout(r, 250));

    expect(h.actions.map((a) => a.type)).not.toContain('PEER_JOINED');
  });
});

describe('★ рассылка своего media:state (задачи 6.2, 7.3, ФТ-15…18)', () => {
  it('setMediaState отправляет состояние на сервер', async () => {
    stub = await startStub(OK_ACK);
    const received: unknown[] = [];
    stub.io.on('connection', (socket) => {
      socket.on('media:state', (payload) => received.push(payload));
    });
    const h = connect(stub.url);
    await waitForAction(h.actions, 'JOINED');

    h.connection.setMediaState({ audio: false, video: true });

    await vi.waitFor(() => expect(received).toEqual([{ audio: false, video: true }]), {
      timeout: 4_000,
    });
  });

  it('после teardown состояние не отправляется — сокета уже нет', async () => {
    stub = await startStub(OK_ACK);
    const received: unknown[] = [];
    stub.io.on('connection', (socket) => {
      socket.on('media:state', (payload) => received.push(payload));
    });
    const h = connect(stub.url);
    await waitForAction(h.actions, 'JOINED');

    h.connection.dispose();
    h.connection.setMediaState({ audio: true, video: true });
    await new Promise((r) => setTimeout(r, 250));

    expect(received).toEqual([]);
  });
});
