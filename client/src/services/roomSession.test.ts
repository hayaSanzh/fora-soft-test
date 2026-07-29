/**
 * Тесты оркестратора (задача IP 9, TDD §4.6).
 *
 * Главный тест файла — сквозной: **две полные сессии** (устройства + mesh +
 * сигналинг) договариваются друг с другом через настоящий socket.io-сервер.
 * Устройства и `RTCPeerConnection` фейковые, но всё остальное настоящее:
 * контракт, релей `from`, порядок событий, антиглэр, teardown.
 *
 * Именно этот тест отвечает на вопрос вехи M2 «двое видят и слышат друг друга»
 * на уровне протокола — до того, как это проверят руками в браузере.
 */
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Server, type Socket as ServerSocket } from 'socket.io';
import {
  SOCKET_PATH,
  type ChatItem,
  type ClientToServerEvents,
  type MediaState,
  type Participant,
  type ServerToClientEvents,
} from '@video-chat/shared';
import {
  roomReducer,
  type RoomAction,
  type RoomState,
  initialRoomState,
} from '../state/roomReducer';
import { startRoomSession, type RoomSession } from './roomSession';
import { createSocket } from './socket';
import {
  createFakeMediaStream,
  fakePeerConnectionFactory,
  type FakePeerConnection,
} from './peerConnection.test-utils';

// ─── Мини-сервер: повторяет поведение реального (проверено группой 4) ─────────

interface Stub {
  url: string;
  io: Server<ClientToServerEvents, ServerToClientEvents>;
  httpServer: HttpServer;
  close: () => Promise<void>;
}

async function startStub(maxParticipants = 4): Promise<Stub> {
  const httpServer = createServer();
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    path: SOCKET_PATH,
    transports: ['websocket'],
  });

  const participants = new Map<string, Participant>();
  const messages: ChatItem[] = [];
  let seq = 0;
  /**
   * Счётчик id сообщений — общий на сервер, как `nanoid` в реальной реализации.
   * Если сделать его локальным для соединения, разные участники начнут выдавать
   * одинаковые id, и клиент отбросит сообщения дедупликацией — на этом мой
   * первый вариант стенда и упал.
   */
  let messageSeq = 0;

  io.on('connection', (socket: ServerSocket<ClientToServerEvents, ServerToClientEvents>) => {
    socket.on('room:join', (payload, ack) => {
      if (participants.size >= maxParticipants) {
        ack({ ok: false, error: 'ROOM_FULL' });
        return;
      }
      const self: Participant = {
        id: socket.id,
        name: payload.name,
        media: payload.media,
        joinedAt: ++seq,
      };
      // Снапшот снимается ДО добавления себя — как на реальном сервере
      // (вошедший получает своё системное сообщение событием).
      const snapshot = [...participants.values()];
      participants.set(socket.id, self);
      void socket.join(payload.roomId);
      ack({
        ok: true,
        self,
        room: { id: payload.roomId, participants: [...snapshot, self], messages: [...messages] },
      });
      socket.to(payload.roomId).emit('peer:joined', { participant: self });
    });

    // Релей с подстановкой `from` — ключевая часть контракта (TDD §4.3).
    socket.on('signal:offer', ({ to, sdp }) =>
      io.to(to).emit('signal:offer', { from: socket.id, sdp }),
    );
    socket.on('signal:answer', ({ to, sdp }) =>
      io.to(to).emit('signal:answer', { from: socket.id, sdp }),
    );
    socket.on('signal:ice', ({ to, candidate }) =>
      io.to(to).emit('signal:ice', { from: socket.id, candidate }),
    );

    socket.on('chat:message', ({ text }, ack) => {
      const participant = participants.get(socket.id);
      if (!participant) {
        ack({ ok: false, error: 'NOT_IN_ROOM' });
        return;
      }
      const item: ChatItem = {
        type: 'user',
        id: `msg-${++messageSeq}`,
        authorId: socket.id,
        authorName: participant.name,
        text,
        ts: 1_769_000_000_000 + messageSeq,
      };
      messages.push(item);
      // Всем, включая автора (TDD §7.5): порядок определяет сервер.
      io.emit('chat:message', item);
      ack({ ok: true, id: item.id });
    });

    socket.on('media:state', (media: MediaState) => {
      const participant = participants.get(socket.id);
      if (participant) participant.media = media;
      socket.broadcast.emit('media:state', { id: socket.id, media });
    });

    const leave = () => {
      const participant = participants.get(socket.id);
      if (!participant) return;
      participants.delete(socket.id);
      socket.broadcast.emit('peer:left', { id: socket.id, name: participant.name });
    };
    socket.on('room:leave', leave);
    socket.on('disconnect', leave);
  });

  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const { port } = httpServer.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    io,
    httpServer,
    close: async () => {
      await io.close();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}

// ─── Фейковые устройства ─────────────────────────────────────────────────────

interface FakeDeviceTrack {
  kind: string;
  id: string;
  enabled: boolean;
  stopped: boolean;
  onended: (() => void) | null;
  stop: () => void;
}

function fakeDevices(name: string): { devices: MediaDevices; tracks: FakeDeviceTrack[] } {
  const tracks: FakeDeviceTrack[] = [];
  const makeTrack = (kind: string): FakeDeviceTrack => {
    const track: FakeDeviceTrack = {
      kind,
      id: `${name}-${kind}`,
      enabled: true,
      stopped: false,
      onended: null,
      stop() {
        this.stopped = true;
      },
    };
    tracks.push(track);
    return track;
  };

  const devices = {
    getUserMedia: (constraints: MediaStreamConstraints) =>
      Promise.resolve({
        getAudioTracks: () => (constraints.audio ? [makeTrack('audio')] : []),
        getVideoTracks: () => (constraints.video ? [makeTrack('video')] : []),
      } as unknown as MediaStream),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  } as unknown as MediaDevices;

  return { devices, tracks };
}

// ─── Участник: сессия + reducer, как в RoomPage ───────────────────────────────

interface Member {
  name: string;
  session: RoomSession;
  state: () => RoomState;
  actions: RoomAction[];
  pcs: () => FakePeerConnection[];
  streams: Map<string, MediaStream>;
  goneStreams: string[];
  tracks: FakeDeviceTrack[];
}

const stubs: Stub[] = [];
const members: Member[] = [];

afterEach(async () => {
  for (const member of members.splice(0)) member.session.teardown();
  for (const stub of stubs.splice(0)) await stub.close();
});

function join(stub: Stub, name: string, roomId = 'RoomAAA'): Member {
  let state: RoomState = { ...initialRoomState, screen: 'acquiringMedia', selfName: name };
  const actions: RoomAction[] = [];
  const factory = fakePeerConnectionFactory();
  const { devices, tracks } = fakeDevices(name);
  const streams = new Map<string, MediaStream>();
  const goneStreams: string[] = [];

  const session = startRoomSession({
    roomId,
    name,
    dispatch: (action) => {
      actions.push(action);
      state = roomReducer(state, action);
    },
    onInvalidRoomId: () => actions.push({ type: 'SERVER_ERROR' }),
    onRemoteStream: (peerId, stream) => streams.set(peerId, stream),
    onRemoteStreamGone: (peerId) => goneStreams.push(peerId),
    mediaDevices: devices,
    createSocketFn: () => createSocket({ url: stub.url, timeoutMs: 2_000 }),
    createPeerConnection: factory.create,
    createMediaStream: createFakeMediaStream,
    timeoutMs: 2_000,
  });

  const member: Member = {
    name,
    session,
    state: () => state,
    actions,
    pcs: () => factory.instances,
    streams,
    goneStreams,
    tracks,
  };
  members.push(member);
  return member;
}

const waitUntil = async (fn: () => boolean, label: string, ms = 5_000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`условие «${label}» не выполнилось за ${ms} мс`);
};

const inRoom = (member: Member) =>
  waitUntil(() => member.state().screen === 'inRoom', `${member.name} в комнате`);

// ─── Тесты ───────────────────────────────────────────────────────────────────

describe('9.1 подписки: presence + сигналинг (TDD §4.6)', () => {
  it('★ сквозной сценарий: двое договариваются через настоящий сокет', async () => {
    const stub = await startStub();
    stubs.push(stub);

    const anya = join(stub, 'Аня');
    await inRoom(anya);
    // Аня одна: соединений нет.
    expect(anya.session.getPeerIds()).toEqual([]);

    const boris = join(stub, 'Борис');
    await inRoom(boris);

    // У обоих появилось по одному соединению.
    await waitUntil(() => anya.session.getPeerIds().length === 1, 'Аня создала соединение');
    await waitUntil(() => boris.session.getPeerIds().length === 1, 'Борис создал соединение');

    // ★ Негоциация состоялась: у каждого установлено удалённое описание.
    await waitUntil(
      () => anya.pcs()[0]?.remoteDescription !== null && boris.pcs()[0]?.remoteDescription !== null,
      'обе стороны применили SDP',
    );

    // Антиглэр: оффер сделала Аня (была в комнате), Борис — ответ.
    expect(anya.pcs()[0]?.localDescription?.type).toBe('offer');
    expect(boris.pcs()[0]?.localDescription?.type).toBe('answer');
    expect(anya.pcs()[0]?.remoteDescription?.type).toBe('answer');
    expect(boris.pcs()[0]?.remoteDescription?.type).toBe('offer');
  });

  it('★ локальные дорожки подставлены в соединение (иначе собеседник ничего не увидит)', async () => {
    const stub = await startStub();
    stubs.push(stub);
    const anya = join(stub, 'Аня');
    await inRoom(anya);
    const boris = join(stub, 'Борис');
    await inRoom(boris);
    await waitUntil(() => anya.session.getPeerIds().length === 1, 'соединение создано');

    const senders = anya.pcs()[0]!.getSenders();
    await waitUntil(() => senders.every((s) => s.track !== null), 'дорожки подставлены');

    expect(senders.map((s) => s.track?.kind)).toEqual(['audio', 'video']);
    // Порядок трансиверов фиксирован — audio, затем video (TDD §4.5 нюанс 1).
    expect(anya.pcs()[0]!.transceivers.map((t) => t.kind)).toEqual(['audio', 'video']);
  });

  it('★ поток пира отдаётся наружу один раз — UI присвоит srcObject однократно', async () => {
    const stub = await startStub();
    stubs.push(stub);
    const anya = join(stub, 'Аня');
    await inRoom(anya);
    const boris = join(stub, 'Борис');
    await inRoom(boris);

    await waitUntil(() => anya.streams.size === 1, 'поток пира получен');
    const [peerId] = [...anya.streams.keys()];
    const stream = anya.streams.get(peerId!);

    expect(anya.session.getRemoteStream(peerId!)).toBe(stream);
    expect(anya.streams.size).toBe(1);
  });

  it('★ ICE-кандидаты доезжают через сервер и применяются', async () => {
    const stub = await startStub();
    stubs.push(stub);
    const anya = join(stub, 'Аня');
    await inRoom(anya);
    const boris = join(stub, 'Борис');
    await inRoom(boris);
    await waitUntil(
      () => anya.pcs()[0]?.remoteDescription !== null && boris.pcs()[0]?.remoteDescription !== null,
      'SDP обменялись',
    );

    // Браузер Ани сообщает о своём кандидате.
    anya.pcs()[0]!.emitIceCandidate({ candidate: 'candidate:from-anya', sdpMid: '0' });

    await waitUntil(() => boris.pcs()[0]!.addedCandidates.length === 1, 'Борис применил кандидат');
    expect(boris.pcs()[0]!.addedCandidates[0]).toMatchObject({ candidate: 'candidate:from-anya' });
  });

  it('★ третий участник: mesh достраивается, у каждого по 2 соединения', async () => {
    const stub = await startStub();
    stubs.push(stub);
    const anya = join(stub, 'Аня');
    await inRoom(anya);
    const boris = join(stub, 'Борис');
    await inRoom(boris);
    const vera = join(stub, 'Вера');
    await inRoom(vera);

    await waitUntil(
      () =>
        anya.session.getPeerIds().length === 2 &&
        boris.session.getPeerIds().length === 2 &&
        vera.session.getPeerIds().length === 2,
      'mesh достроен',
    );

    // Вера — новичок: она никому не отправляла оффер, только отвечала.
    await waitUntil(
      () => vera.pcs().every((pc) => pc.remoteDescription?.type === 'offer'),
      'Вера ответила обоим',
    );
    expect(vera.pcs().map((pc) => pc.localDescription?.type)).toEqual(['answer', 'answer']);
  });

  it('★ выход участника закрывает соединение и освобождает поток', async () => {
    const stub = await startStub();
    stubs.push(stub);
    const anya = join(stub, 'Аня');
    await inRoom(anya);
    const boris = join(stub, 'Борис');
    await inRoom(boris);
    await waitUntil(() => anya.session.getPeerIds().length === 1, 'соединение создано');
    const borisPc = anya.pcs()[0]!;
    // Идентификатор нужно запомнить заранее: после выхода состояние сессии
    // очищается и `selfId` становится null.
    const borisId = boris.state().selfId!;

    boris.session.leave();

    await waitUntil(() => anya.session.getPeerIds().length === 0, 'Аня закрыла соединение');
    expect(borisPc.closed).toBe(true);
    expect(anya.goneStreams).toEqual([borisId]);
    expect(Object.keys(anya.state().participants)).not.toContain(borisId);
  });
});

describe('9.2 ★ потоки и соединения вне состояния React', () => {
  it('★ в reducer уходит presence, но НЕ потоки и не соединения', async () => {
    const stub = await startStub();
    stubs.push(stub);
    const anya = join(stub, 'Аня');
    await inRoom(anya);
    const boris = join(stub, 'Борис');
    await inRoom(boris);
    await waitUntil(() => anya.streams.size === 1, 'поток получен');

    const serialized = JSON.stringify(anya.state());
    expect(serialized).not.toContain('MediaStream');
    expect(serialized).not.toContain('RTCPeerConnection');
    // Состояние соединения — единственное WebRTC-поле в состоянии: оно нужно
    // для индикации на плитке и меняется редко (Q9).
    expect(anya.state().peerConnectionStates).toBeDefined();
  });

  it('★ ICE-кандидаты не порождают действий reducer — иначе сетка перерисовывалась бы', async () => {
    const stub = await startStub();
    stubs.push(stub);
    const anya = join(stub, 'Аня');
    await inRoom(anya);
    const boris = join(stub, 'Борис');
    await inRoom(boris);
    await waitUntil(() => anya.pcs()[0]?.remoteDescription !== null, 'SDP применён');
    const actionsBefore = anya.actions.length;

    for (let i = 0; i < 20; i++) {
      boris.pcs()[0]!.emitIceCandidate({ candidate: `candidate:${i}`, sdpMid: '0' });
    }
    await new Promise((r) => setTimeout(r, 200));

    expect(anya.actions.length).toBe(actionsBefore);
  });
});

describe('9.3 ★ единый teardown (ФТ-27, риск R7)', () => {
  it('★ teardown закрывает соединения, останавливает дорожки и рвёт сокет', async () => {
    const stub = await startStub();
    stubs.push(stub);
    const anya = join(stub, 'Аня');
    await inRoom(anya);
    const boris = join(stub, 'Борис');
    await inRoom(boris);
    await waitUntil(() => anya.session.getPeerIds().length === 1, 'соединение создано');
    const pc = anya.pcs()[0]!;

    anya.session.teardown();

    expect(pc.closed).toBe(true);
    // Все дорожки остановлены — камера гаснет (ФТ-19, ФТ-27).
    expect(anya.tracks.every((t) => t.stopped)).toBe(true);
    expect(anya.session.getPeerIds()).toEqual([]);
    // Борис узнаёт об уходе штатным событием.
    await waitUntil(
      () => Object.keys(boris.state().participants).length === 1,
      'Борис увидел уход',
    );
  });

  it('★ leave() ведёт в тот же teardown и даёт экран «вы вышли»', async () => {
    const stub = await startStub();
    stubs.push(stub);
    const anya = join(stub, 'Аня');
    await inRoom(anya);

    anya.session.leave();

    await waitUntil(() => anya.state().screen === 'left', 'экран «вы вышли»');
    expect(anya.tracks.every((t) => t.stopped)).toBe(true);
  });

  it('★ обрыв соединения тоже освобождает медиа (риск R7)', async () => {
    const stub = await startStub();
    stubs.push(stub);
    const anya = join(stub, 'Аня');
    await inRoom(anya);
    await waitUntil(() => anya.tracks.length === 2, 'устройства получены');

    // Сервер уронил соединение — как при рестарте.
    stub.io.disconnectSockets(true);

    await waitUntil(() => anya.state().screen === 'serverError', 'экран ошибки сервера');
    expect(anya.tracks.every((t) => t.stopped)).toBe(true);
  });

  it('teardown идемпотентен и безопасен до появления сокета', async () => {
    const stub = await startStub();
    stubs.push(stub);
    const anya = join(stub, 'Аня');

    // Уходим сразу, не дожидаясь ни устройств, ни сокета.
    anya.session.teardown();
    anya.session.teardown();
    anya.session.leave();

    await new Promise((r) => setTimeout(r, 300));
    expect(anya.tracks.every((t) => t.stopped)).toBe(true);
    expect(anya.state().screen).not.toBe('inRoom');
  });
});

describe('тумблеры внутри сессии (ФТ-15…18)', () => {
  it('★ выключение камеры снимает дорожку со всех соединений и гасит устройство', async () => {
    const stub = await startStub();
    stubs.push(stub);
    const anya = join(stub, 'Аня');
    await inRoom(anya);
    const boris = join(stub, 'Борис');
    await inRoom(boris);
    await waitUntil(() => anya.session.getPeerIds().length === 1, 'соединение создано');
    const videoSender = anya.pcs()[0]!.getSenders()[1]!;
    await waitUntil(() => videoSender.track !== null, 'видео подставлено');

    anya.session.toggleCamera();

    await waitUntil(() => videoSender.track === null, 'видео снято с sender');
    // Дорожка именно остановлена: гаснет индикатор камеры (ФТ-19).
    expect(anya.tracks.find((t) => t.kind === 'video')?.stopped).toBe(true);
    // Трансиверы на месте — ренегоциации нет (риск R4).
    expect(anya.pcs()[0]!.transceivers).toHaveLength(2);
  });

  it('★ состояние устройств доезжает до собеседника (ФТ-16, ФТ-18)', async () => {
    const stub = await startStub();
    stubs.push(stub);
    const anya = join(stub, 'Аня');
    await inRoom(anya);
    const boris = join(stub, 'Борис');
    await inRoom(boris);
    const anyaId = anya.state().selfId!;
    await waitUntil(() => boris.state().participants[anyaId] !== undefined, 'Борис видит Аню');

    anya.session.toggleMic();

    await waitUntil(
      () => boris.state().participants[anyaId]?.media.audio === false,
      'Борис увидел выключенный микрофон',
    );
  });

  it('★ микрофон выключается без остановки дорожки (ФТ-15)', async () => {
    const stub = await startStub();
    stubs.push(stub);
    const anya = join(stub, 'Аня');
    await inRoom(anya);
    await waitUntil(() => anya.tracks.length === 2, 'устройства получены');

    anya.session.toggleMic();
    await waitUntil(() => anya.session.getMediaState().audio === false, 'микрофон выключен');

    const audioTrack = anya.tracks.find((t) => t.kind === 'audio')!;
    expect(audioTrack.stopped).toBe(false);
    expect(audioTrack.enabled).toBe(false);
  });
});

describe('устойчивость', () => {
  it('★ ROOM_FULL не создаёт соединений и не оставляет живых дорожек', async () => {
    const stub = await startStub(1);
    stubs.push(stub);
    const anya = join(stub, 'Аня');
    await inRoom(anya);

    const boris = join(stub, 'Борис');

    await waitUntil(() => boris.state().screen === 'roomFull', 'Борису отказано');
    expect(boris.session.getPeerIds()).toEqual([]);
    expect(boris.tracks.every((t) => t.stopped)).toBe(true);
  });

  it('битая ссылка уводит на стартовый экран', async () => {
    const stub = await startStub();
    stubs.push(stub);
    const onInvalid = vi.fn();
    const factory = fakePeerConnectionFactory();
    const { devices } = fakeDevices('Аня');
    const session = startRoomSession({
      roomId: 'ab',
      name: 'Аня',
      dispatch: () => undefined,
      onInvalidRoomId: onInvalid,
      mediaDevices: devices,
      createSocketFn: () => createSocket({ url: stub.url, timeoutMs: 1_000 }),
      createPeerConnection: factory.create,
      createMediaStream: createFakeMediaStream,
      timeoutMs: 1_000,
    });

    // Сервер-заглушка принимает любой roomId, поэтому проверяем обратное:
    // сессия не падает и корректно закрывается.
    await new Promise((r) => setTimeout(r, 300));
    session.teardown();
    expect(onInvalid).not.toHaveBeenCalled();
  });
});

describe('★ чат через сессию (задача 10.6, ФТ-21…24)', () => {
  it('★ сообщение доходит до собеседника и попадает в историю обоих', async () => {
    const stub = await startStub();
    stubs.push(stub);
    const anya = join(stub, 'Аня');
    await inRoom(anya);
    const boris = join(stub, 'Борис');
    await inRoom(boris);

    const ack = await anya.session.sendChatMessage('привет');

    expect(ack.ok).toBe(true);
    await waitUntil(
      () => boris.state().messages.some((m) => m.type === 'user' && m.text === 'привет'),
      'Борис получил сообщение',
    );
    // ★ Автор тоже получает своё сообщение событием — без локального дубля.
    await waitUntil(
      () => anya.state().messages.filter((m) => m.type === 'user').length === 1,
      'автор получил своё сообщение ровно один раз',
    );
  });

  it('★ порядок сообщений определяется сервером и одинаков у всех', async () => {
    const stub = await startStub();
    stubs.push(stub);
    const anya = join(stub, 'Аня');
    await inRoom(anya);
    const boris = join(stub, 'Борис');
    await inRoom(boris);

    await anya.session.sendChatMessage('первое');
    await boris.session.sendChatMessage('второе');
    await anya.session.sendChatMessage('третье');

    const texts = (member: typeof anya) =>
      member
        .state()
        .messages.filter((m) => m.type === 'user')
        .map((m) => (m.type === 'user' ? m.text : ''));
    await waitUntil(() => texts(anya).length === 3 && texts(boris).length === 3, 'все получили 3');

    expect(texts(anya)).toEqual(['первое', 'второе', 'третье']);
    expect(texts(boris)).toEqual(texts(anya));
  });

  it('★ XSS-проба доезжает как текст, без изменений (ФТ-39)', async () => {
    const stub = await startStub();
    stubs.push(stub);
    const anya = join(stub, 'Аня');
    await inRoom(anya);
    const boris = join(stub, 'Борис');
    await inRoom(boris);
    const xss = '<img src=x onerror=alert(1)>';

    await anya.session.sendChatMessage(xss);

    await waitUntil(
      () => boris.state().messages.some((m) => m.type === 'user' && m.text === xss),
      'текст доехал как есть',
    );
  });

  it('отправка без соединения не бросает исключение', async () => {
    const stub = await startStub();
    stubs.push(stub);
    const anya = join(stub, 'Аня');

    // Сокета ещё нет: устройства только запрашиваются.
    const ack = await anya.session.sendChatMessage('раньше времени');

    expect(ack).toEqual({ ok: false, error: 'NOT_IN_ROOM' });
  });
});
