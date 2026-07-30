/**
 * Тесты `PeerManager` (задача IP 8.10, TDD §4.5, §11.1).
 *
 * Проверяется каждый из семи нюансов дизайна — именно они дают дефекты,
 * которые в браузере выглядят как «иногда видео не появляется»:
 * порядок трансиверов, роль polite/impolite, `ignoreOffer` при коллизии,
 * буферизация ICE-кандидатов, один поток на пира, restartIce, идемпотентность
 * `closePeer`.
 *
 * Отдельно — сквозной тест: два `PeerManager` договариваются друг с другом
 * через мокнутые соединения. Он проверяет протокол целиком, а не по частям.
 */
import { describe, expect, it, vi } from 'vitest';
import { config } from '../config';
import { PeerManager, type PeerManagerOptions } from './PeerManager';
import {
  createFakeMediaStream,
  fakePeerConnectionFactory,
  fakeTrack,
  type FakePeerConnection,
  type FakeSender,
} from './peerConnection.test-utils';

interface Harness {
  manager: PeerManager;
  pcs: () => FakePeerConnection[];
  last: () => FakePeerConnection;
  sent: { kind: 'offer' | 'answer' | 'ice'; to: string; payload: unknown }[];
  streams: { peerId: string; stream: MediaStream }[];
  states: { peerId: string; state: RTCPeerConnectionState }[];
  errors: { peerId: string; error: unknown }[];
}

function harness(
  overrides: Partial<PeerManagerOptions> & { selfId?: string } = {},
  pcOptions: { failSetRemoteDescription?: Error } = {},
): Harness {
  const factory = fakePeerConnectionFactory(pcOptions);
  const sent: Harness['sent'] = [];
  const streams: Harness['streams'] = [];
  const states: Harness['states'] = [];
  const errors: Harness['errors'] = [];

  const manager = new PeerManager({
    selfId: 'self',
    createPeerConnection: factory.create,
    createMediaStream: createFakeMediaStream,
    sendOffer: (to, sdp) => sent.push({ kind: 'offer', to, payload: sdp }),
    sendAnswer: (to, sdp) => sent.push({ kind: 'answer', to, payload: sdp }),
    sendIce: (to, candidate) => sent.push({ kind: 'ice', to, payload: candidate }),
    onRemoteStream: (peerId, stream) => streams.push({ peerId, stream }),
    onConnectionState: (peerId, state) => states.push({ peerId, state }),
    onError: (peerId, error) => errors.push({ peerId, error }),
    ...overrides,
  });

  return {
    manager,
    pcs: () => factory.instances,
    last: () => factory.last()!,
    sent,
    streams,
    states,
    errors,
  };
}

const OFFER = { type: 'offer' as const, sdp: 'v=0\r\nremote-offer\r\n' };
const ANSWER = { type: 'answer' as const, sdp: 'v=0\r\nremote-answer\r\n' };
const CANDIDATE = { candidate: 'candidate:1 1 UDP 1 10.0.0.1 5000 typ host', sdpMid: '0' };
/** Даёт исполниться микрозадачам: negotiationneeded приходит асинхронно. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('8.1 скелет: создание и удаление соединений', () => {
  it('создаёт соединение с ICE-конфигурацией из настроек (STUN без TURN)', () => {
    const h = harness();

    h.manager.addPeer('peer-1', false);

    expect(h.pcs()).toHaveLength(1);
    expect(h.last().configuration).toEqual({
      iceServers: [...config.iceServers],
      iceCandidatePoolSize: config.iceCandidatePoolSize,
    });
    expect(h.manager.getPeerIds()).toEqual(['peer-1']);
  });

  it('★ повторный peer:joined не создаёт второе соединение (идемпотентность)', () => {
    const h = harness();

    h.manager.addPeer('peer-1', true);
    h.manager.addPeer('peer-1', true);

    expect(h.pcs()).toHaveLength(1);
  });

  it('★ соединение с самим собой не создаётся', () => {
    const h = harness();

    h.manager.addPeer('self', true);

    expect(h.pcs()).toHaveLength(0);
    expect(h.manager.getPeerIds()).toEqual([]);
  });

  it('closeAll закрывает все соединения (ФТ-27, риск R7)', () => {
    const h = harness();
    h.manager.addPeer('peer-1', false);
    h.manager.addPeer('peer-2', false);

    h.manager.closeAll();

    expect(h.pcs().every((pc) => pc.closed)).toBe(true);
    expect(h.manager.getPeerIds()).toEqual([]);
  });
});

describe('8.2 ★ фиксированные трансиверы (нюанс 1)', () => {
  it('★ ровно два трансивера в порядке audio → video, оба sendrecv', () => {
    const h = harness();

    h.manager.addPeer('peer-1', false);

    expect(h.last().transceivers.map((t) => t.kind)).toEqual(['audio', 'video']);
    expect(h.last().transceivers.map((t) => t.direction)).toEqual(['sendrecv', 'sendrecv']);
  });

  it('★ трансиверы создаются даже без локальных устройств — SDP остаётся валидным (ФТ-14)', () => {
    const h = harness({ getLocalTracks: () => ({ audio: null, video: null }) });

    h.manager.addPeer('peer-1', false);

    expect(h.last().transceivers).toHaveLength(2);
    // `replaceTrack(null)` для отсутствующих дорожек — форма SDP не меняется.
    expect(
      h
        .last()
        .getSenders()
        .map((s) => s.track),
    ).toEqual([null, null]);
  });

  it('локальные дорожки подставляются через replaceTrack, а не addTrack', async () => {
    const audio = fakeTrack('audio');
    const video = fakeTrack('video');
    const h = harness({ getLocalTracks: () => ({ audio, video }) });

    h.manager.addPeer('peer-1', false);
    await tick();

    const [audioSender, videoSender] = h.last().getSenders();
    expect(audioSender?.track).toBe(audio);
    expect(videoSender?.track).toBe(video);
  });

  it('потолок битрейта применяется только при включённом флаге (Q5)', async () => {
    const h = harness({ getLocalTracks: () => ({ audio: null, video: fakeTrack('video') }) });

    h.manager.addPeer('peer-1', false);
    await tick();

    const videoSender = h.last().getSenders()[1] as FakeSender;
    // Дефолт `maxVideoBitrate: null` — параметры не трогаем.
    expect(config.maxVideoBitrate).toBeNull();
    expect(videoSender.setParametersCalls).toHaveLength(0);
  });

  /**
   * ★ Проверка **включённого** потолка (задача 14.7, риск R2).
   *
   * До группы 14 проверялось только выключенное состояние, то есть единственная
   * мера против упирания в канал на четырёх участниках существовала «на словах»:
   * инструкция велит включить `VITE_MAX_VIDEO_BITRATE` по результатам замеров, а
   * работает ли флаг — никто не проверял. Потолок вынесен в опции `PeerManager`
   * ровно ради этой проверки.
   */
  describe('★ включённый потолок битрейта (Q5, R2, задача 14.7)', () => {
    it('★ maxBitrate попадает в каждый encoding видеоотправителя', async () => {
      const h = harness({
        maxVideoBitrate: 800_000,
        getLocalTracks: () => ({ audio: null, video: fakeTrack('video') }),
      });

      h.manager.addPeer('peer-1', false);
      await tick();

      const videoSender = h.last().getSenders()[1] as FakeSender;
      expect(videoSender.setParametersCalls).toHaveLength(1);
      const encodings = videoSender.setParametersCalls[0]?.encodings ?? [];
      expect(encodings.length).toBeGreaterThan(0);
      for (const encoding of encodings) expect(encoding.maxBitrate).toBe(800_000);
    });

    it('★ аудиоотправителя потолок не касается: речь важнее картинки', async () => {
      const h = harness({
        maxVideoBitrate: 800_000,
        getLocalTracks: () => ({ audio: fakeTrack('audio'), video: fakeTrack('video') }),
      });

      h.manager.addPeer('peer-1', false);
      await tick();

      const audioSender = h.last().getSenders()[0] as FakeSender;
      expect(audioSender.setParametersCalls).toHaveLength(0);
    });

    it('★ потолок применяется и при возврате камеры через replaceTrack', async () => {
      const h = harness({ maxVideoBitrate: 500_000 });

      h.manager.addPeer('peer-1', false);
      await tick();
      const videoSender = h.last().getSenders()[1] as FakeSender;
      const before = videoSender.setParametersCalls.length;

      await h.manager.replaceOutgoingVideo(fakeTrack('video'));

      expect(videoSender.setParametersCalls.length).toBe(before + 1);
      expect(videoSender.setParametersCalls.at(-1)?.encodings?.[0]?.maxBitrate).toBe(500_000);
    });

    it('★ выключение камеры потолок не применяет: дорожки нет', async () => {
      const h = harness({
        maxVideoBitrate: 500_000,
        getLocalTracks: () => ({ audio: null, video: fakeTrack('video') }),
      });

      h.manager.addPeer('peer-1', false);
      await tick();
      const videoSender = h.last().getSenders()[1] as FakeSender;
      const before = videoSender.setParametersCalls.length;

      await h.manager.replaceOutgoingVideo(null);

      expect(videoSender.setParametersCalls.length).toBe(before);
    });
  });
});

describe('8.3 ★ антиглэр: один оффер на пару (нюанс 2)', () => {
  it('★ инициатор (уже в комнате) отправляет оффер', async () => {
    const h = harness();

    h.manager.addPeer('peer-1', true);
    await tick();

    const offers = h.sent.filter((s) => s.kind === 'offer');
    expect(offers).toHaveLength(1);
    expect(offers[0]?.to).toBe('peer-1');
  });

  it('★ новичок (не инициатор) оффер НЕ отправляет, даже получив negotiationneeded', async () => {
    const h = harness();

    h.manager.addPeer('peer-1', false);
    await tick();
    h.last().emitNegotiationNeeded();
    await tick();

    expect(h.sent.filter((s) => s.kind === 'offer')).toHaveLength(0);
  });

  it('★ новичок отвечает на оффер и только после этого получает право на оффер', async () => {
    const h = harness();
    h.manager.addPeer('peer-1', false);
    await tick();

    await h.manager.handleOffer('peer-1', OFFER);

    const answers = h.sent.filter((s) => s.kind === 'answer');
    expect(answers).toHaveLength(1);
    expect(answers[0]?.to).toBe('peer-1');

    // Теперь ренегоциация разрешена (например, при смене устройства).
    h.last().emitNegotiationNeeded();
    await tick();
    expect(h.sent.filter((s) => s.kind === 'offer')).toHaveLength(1);
  });

  it('инициатор применяет полученный ответ', async () => {
    const h = harness();
    h.manager.addPeer('peer-1', true);
    await tick();

    await h.manager.handleAnswer('peer-1', ANSWER);

    expect(h.last().remoteDescription).toEqual(ANSWER);
  });
});

describe('8.5 ★ perfect negotiation (нюанс 3)', () => {
  it('★ роль вычисляется из идентификаторов: polite = selfId > peerId', async () => {
    // 'aaa' < 'zzz' → мы невежливые по отношению к 'zzz'…
    const impolite = harness({ selfId: 'aaa' });
    impolite.manager.addPeer('zzz', true);
    await tick();
    // …и вежливые по отношению к 'AAA' (заглавные меньше строчных).
    const polite = harness({ selfId: 'aaa' });
    polite.manager.addPeer('AAA', true);
    await tick();

    // Коллизия: мы делаем оффер и одновременно получаем чужой.
    await impolite.manager.handleOffer('zzz', OFFER);
    await polite.manager.handleOffer('AAA', OFFER);

    // Невежливый отбрасывает чужой оффер: ответа нет, своё описание сохранено.
    expect(impolite.sent.filter((s) => s.kind === 'answer')).toHaveLength(0);
    // Вежливый уступает: принимает чужой оффер и отвечает.
    expect(polite.sent.filter((s) => s.kind === 'answer')).toHaveLength(1);
  });

  it('★ ignoreOffer при коллизии: невежливый сохраняет своё локальное описание', async () => {
    const h = harness({ selfId: 'aaa' });
    h.manager.addPeer('zzz', true);
    await tick();
    const localBefore = h.last().localDescription;

    await h.manager.handleOffer('zzz', OFFER);

    expect(h.last().localDescription).toBe(localBefore);
    expect(h.last().remoteDescription).toBeNull();
  });

  it('вне коллизии оффер принимается независимо от роли', async () => {
    const h = harness({ selfId: 'aaa' });
    h.manager.addPeer('zzz', false); // не инициатор → своего оффера нет
    await tick();

    await h.manager.handleOffer('zzz', OFFER);

    expect(h.last().remoteDescription).toEqual(OFFER);
    expect(h.sent.filter((s) => s.kind === 'answer')).toHaveLength(1);
  });

  it('оффер использует setLocalDescription() без аргументов', async () => {
    const h = harness();

    h.manager.addPeer('peer-1', true);
    await tick();

    // Мок сам определил тип по состоянию — значит аргумент не передавался.
    expect(h.last().localDescription?.type).toBe('offer');
  });

  it('ошибка setRemoteDescription не роняет менеджер, а уходит в onError', async () => {
    const h = harness({}, { failSetRemoteDescription: new Error('InvalidAccessError') });
    h.manager.addPeer('peer-1', false);
    await tick();

    await h.manager.handleOffer('peer-1', OFFER);

    expect(h.errors).toHaveLength(1);
    expect(h.sent.filter((s) => s.kind === 'answer')).toHaveLength(0);
  });
});

describe('8.4 ★ trickle ICE и буфер кандидатов (нюанс 4)', () => {
  it('локальные кандидаты уходят наружу по мере появления', () => {
    const h = harness();
    h.manager.addPeer('peer-1', true);

    h.last().emitIceCandidate(CANDIDATE);
    h.last().emitIceCandidate(null); // конец сбора — отправлять нечего

    const ice = h.sent.filter((s) => s.kind === 'ice');
    expect(ice).toHaveLength(1);
    expect(ice[0]).toMatchObject({ to: 'peer-1', payload: CANDIDATE });
  });

  it('★ кандидат, пришедший до SDP, буферизуется, а не теряется и не бросает', async () => {
    const h = harness();
    h.manager.addPeer('peer-1', false);
    await tick();

    await h.manager.handleIce('peer-1', CANDIDATE);

    // Реальный addIceCandidate до setRemoteDescription бросает исключение.
    expect(h.last().addedCandidates).toHaveLength(0);
    expect(h.errors).toHaveLength(0);
  });

  it('★ буфер сбрасывается сразу после setRemoteDescription, с сохранением порядка', async () => {
    const h = harness();
    h.manager.addPeer('peer-1', false);
    await tick();
    await h.manager.handleIce('peer-1', { ...CANDIDATE, sdpMid: 'first' });
    await h.manager.handleIce('peer-1', { ...CANDIDATE, sdpMid: 'second' });

    await h.manager.handleOffer('peer-1', OFFER);

    expect(h.last().addedCandidates.map((c) => c.sdpMid)).toEqual(['first', 'second']);
  });

  it('после установленного SDP кандидаты применяются сразу', async () => {
    const h = harness();
    h.manager.addPeer('peer-1', false);
    await tick();
    await h.manager.handleOffer('peer-1', OFFER);

    await h.manager.handleIce('peer-1', CANDIDATE);

    expect(h.last().addedCandidates).toHaveLength(1);
  });

  it('буфер сбрасывается и при получении ответа (путь инициатора)', async () => {
    const h = harness();
    h.manager.addPeer('peer-1', true);
    await tick();
    await h.manager.handleIce('peer-1', CANDIDATE);

    await h.manager.handleAnswer('peer-1', ANSWER);

    expect(h.last().addedCandidates).toHaveLength(1);
  });

  it('кандидаты отброшенного оффера не считаются ошибкой (нюанс 3)', async () => {
    const h = harness({ selfId: 'aaa' });
    h.manager.addPeer('zzz', true);
    await tick();
    await h.manager.handleOffer('zzz', OFFER); // коллизия → ignoreOffer

    await h.manager.handleIce('zzz', CANDIDATE);

    // remoteDescription так и не установлен → кандидат просто буферизован.
    expect(h.errors).toHaveLength(0);
  });

  it('сигналинг для неизвестного пира игнорируется без исключений', async () => {
    const h = harness();

    await h.manager.handleOffer('нет-такого', OFFER);
    await h.manager.handleAnswer('нет-такого', ANSWER);
    await h.manager.handleIce('нет-такого', CANDIDATE);

    expect(h.errors).toHaveLength(0);
    expect(h.sent).toHaveLength(0);
  });
});

describe('8.6 ★ один поток на пира (нюанс 5)', () => {
  it('★ поток создаётся вместе с соединением и отдаётся наружу один раз', () => {
    const h = harness();

    h.manager.addPeer('peer-1', false);

    expect(h.streams).toHaveLength(1);
    expect(h.streams[0]?.peerId).toBe('peer-1');
    expect(h.manager.getRemoteStream('peer-1')).toBe(h.streams[0]?.stream);
  });

  it('★ дорожки добавляются в СУЩЕСТВУЮЩИЙ поток, объект не пересоздаётся', () => {
    const h = harness();
    h.manager.addPeer('peer-1', false);
    const stream = h.manager.getRemoteStream('peer-1');

    h.last().emitTrack({ kind: 'audio', id: 'remote-audio' });
    h.last().emitTrack({ kind: 'video', id: 'remote-video' });

    // Тот же объект: `srcObject` в UI присваивается ровно один раз.
    expect(h.manager.getRemoteStream('peer-1')).toBe(stream);
    expect((stream as unknown as { tracks: { id: string }[] }).tracks.map((t) => t.id)).toEqual([
      'remote-audio',
      'remote-video',
    ]);
    // Повторных уведомлений о потоке нет — иначе UI пересоздал бы srcObject.
    expect(h.streams).toHaveLength(1);
  });

  it('дорожки, пришедшие после закрытия, игнорируются', () => {
    const h = harness();
    h.manager.addPeer('peer-1', false);
    const pc = h.last();
    const stream = h.manager.getRemoteStream('peer-1');
    h.manager.closePeer('peer-1');

    pc.emitTrack({ kind: 'audio', id: 'late' });

    expect((stream as unknown as { tracks: unknown[] }).tracks).toHaveLength(0);
  });
});

describe('8.7 ★ деградация по частям (нюанс 6, ФТ-34, риск R1)', () => {
  it('состояния соединения уходят наружу для индикации на плитке (Q9)', () => {
    const h = harness();
    h.manager.addPeer('peer-1', false);

    h.last().emitConnectionState('connecting');
    h.last().emitConnectionState('connected');

    expect(h.states).toEqual([
      { peerId: 'peer-1', state: 'connecting' },
      { peerId: 'peer-1', state: 'connected' },
    ]);
  });

  it('★ failed → ровно одна попытка restartIce, дальше только пометка плитки', () => {
    const h = harness();
    h.manager.addPeer('peer-1', false);

    h.last().emitConnectionState('failed');
    h.last().emitConnectionState('failed');
    h.last().emitConnectionState('failed');

    expect(h.last().restartIceCalls).toHaveLength(1);
    expect(h.states.filter((s) => s.state === 'failed')).toHaveLength(3);
  });

  it('★ падение одного соединения не влияет на остальные', () => {
    const h = harness();
    h.manager.addPeer('peer-1', false);
    const first = h.last();
    h.manager.addPeer('peer-2', false);
    const second = h.last();

    first.emitConnectionState('failed');

    expect(first.restartIceCalls).toHaveLength(1);
    expect(second.restartIceCalls).toHaveLength(0);
    expect(second.closed).toBe(false);
    expect(h.manager.getPeerIds()).toEqual(['peer-1', 'peer-2']);
  });

  it('после закрытия состояния наружу не уходят', () => {
    const h = harness();
    h.manager.addPeer('peer-1', false);
    const pc = h.last();
    h.manager.closePeer('peer-1');
    h.states.length = 0;

    pc.emitConnectionState('failed');

    expect(h.states).toHaveLength(0);
  });
});

describe('8.8 замена исходящих дорожек во всех соединениях', () => {
  it('★ replaceOutgoingVideo применяется ко всем пирам разом', async () => {
    const h = harness();
    h.manager.addPeer('peer-1', false);
    h.manager.addPeer('peer-2', false);
    h.manager.addPeer('peer-3', false);
    const track = fakeTrack('video');

    await h.manager.replaceOutgoingVideo(track);

    for (const pc of h.pcs()) {
      const [audioSender, videoSender] = pc.getSenders();
      expect(videoSender?.track).toBe(track);
      // Аудио не задето: тумблеры независимы.
      expect(audioSender?.track).toBeNull();
    }
  });

  it('★ выключение камеры: replaceTrack(null), а НЕ removeTrack (риск R4)', async () => {
    const h = harness({ getLocalTracks: () => ({ audio: null, video: fakeTrack('video') }) });
    h.manager.addPeer('peer-1', false);
    await tick();

    await h.manager.replaceOutgoingVideo(null);

    const videoSender = h.last().getSenders()[1] as FakeSender;
    expect(videoSender.track).toBeNull();
    expect(videoSender.replaceCalls.at(-1)).toBeNull();
    // Трансиверы на месте — ренегоциация не требуется.
    expect(h.last().transceivers).toHaveLength(2);
  });

  it('replaceOutgoingAudio не трогает видео', async () => {
    const h = harness();
    h.manager.addPeer('peer-1', false);
    const audio = fakeTrack('audio');

    await h.manager.replaceOutgoingAudio(audio);

    const [audioSender, videoSender] = h.last().getSenders();
    expect(audioSender?.track).toBe(audio);
    expect(videoSender?.track).toBeNull();
  });

  it('замена дорожек без пиров безвредна', async () => {
    const h = harness();

    await expect(h.manager.replaceOutgoingVideo(fakeTrack('video'))).resolves.toBeUndefined();
  });
});

describe('8.9 ★ детерминированный teardown (нюанс 7)', () => {
  it('★ снимает обработчики, отпускает дорожки и закрывает соединение', async () => {
    const h = harness({
      getLocalTracks: () => ({ audio: fakeTrack('audio'), video: fakeTrack('video') }),
    });
    h.manager.addPeer('peer-1', false);
    await tick();
    const pc = h.last();

    h.manager.closePeer('peer-1');

    expect(pc.closed).toBe(true);
    expect(pc.onicecandidate).toBeNull();
    expect(pc.ontrack).toBeNull();
    expect(pc.onnegotiationneeded).toBeNull();
    expect(pc.onconnectionstatechange).toBeNull();
    // Дорожки отпущены: камера не остаётся привязанной к мёртвому соединению.
    expect(pc.getSenders().every((s) => s.replaceCalls.at(-1) === null)).toBe(true);
    expect(h.manager.getPeerIds()).toEqual([]);
  });

  it('★ идемпотентен: peer:left может прийти до установления соединения', async () => {
    // С живыми дорожками видно, что `replaceTrack(null)` при закрытии
    // происходит ровно один раз, а не на каждый вызов closePeer.
    const h = harness({
      getLocalTracks: () => ({ audio: fakeTrack('audio'), video: fakeTrack('video') }),
    });
    h.manager.addPeer('peer-1', false);
    await tick();
    const pc = h.last();

    h.manager.closePeer('peer-1');
    h.manager.closePeer('peer-1');
    h.manager.closePeer('нет-такого');

    expect(pc.closed).toBe(true);
    expect(pc.getSenders()[0]?.replaceCalls.filter((t) => t === null)).toHaveLength(1);
  });

  it('сигналинг после закрытия игнорируется', async () => {
    const h = harness();
    h.manager.addPeer('peer-1', false);
    h.manager.closePeer('peer-1');

    await h.manager.handleOffer('peer-1', OFFER);
    await h.manager.handleIce('peer-1', CANDIDATE);

    expect(h.sent).toHaveLength(0);
    expect(h.errors).toHaveLength(0);
  });
});

describe('★ сквозная негоциация двух менеджеров', () => {
  it('★ оффер → ответ → кандидаты: обе стороны получают SDP и ICE друг друга', async () => {
    // Две независимые «стороны», связанные через колбэки: ровно так их свяжет
    // сигналинг в группе 9.
    const alice = harness({ selfId: 'alice' });
    const bob = harness({ selfId: 'bob' });

    alice.manager.setSelfId('alice');
    bob.manager.setSelfId('bob');

    // Алиса уже в комнате, Боб — новичок (антиглэр: оффер только у Алисы).
    alice.manager.addPeer('bob', true);
    bob.manager.addPeer('alice', false);
    await tick();

    // Пересылаем оффер Алисы Бобу.
    const offer = alice.sent.find((s) => s.kind === 'offer');
    expect(offer).toBeDefined();
    await bob.manager.handleOffer('alice', offer!.payload as never);

    // Ответ Боба — Алисе.
    const answer = bob.sent.find((s) => s.kind === 'answer');
    expect(answer).toBeDefined();
    await alice.manager.handleAnswer('bob', answer!.payload as never);

    // Кандидаты в обе стороны.
    alice.last().emitIceCandidate({ candidate: 'a', sdpMid: '0' });
    bob.last().emitIceCandidate({ candidate: 'b', sdpMid: '0' });
    const aliceIce = alice.sent.find((s) => s.kind === 'ice');
    const bobIce = bob.sent.find((s) => s.kind === 'ice');
    await bob.manager.handleIce('alice', aliceIce!.payload as never);
    await alice.manager.handleIce('bob', bobIce!.payload as never);

    // Итог: у обеих сторон установлены удалённые описания и приняты кандидаты.
    expect(alice.last().remoteDescription?.type).toBe('answer');
    expect(bob.last().remoteDescription?.type).toBe('offer');
    expect(alice.last().addedCandidates).toHaveLength(1);
    expect(bob.last().addedCandidates).toHaveLength(1);
    // Ровно один оффер на пару: Боб своего не отправлял.
    expect(bob.sent.filter((s) => s.kind === 'offer')).toHaveLength(0);
    expect(alice.sent.filter((s) => s.kind === 'offer')).toHaveLength(1);
  });

  it('★ одновременные офферы (glare): договариваются без потери соединения', async () => {
    const alice = harness({ selfId: 'alice' });
    const bob = harness({ selfId: 'bob' });

    // Патологический случай: оба считают себя инициаторами.
    alice.manager.addPeer('bob', true);
    bob.manager.addPeer('alice', true);
    await tick();

    const aliceOffer = alice.sent.find((s) => s.kind === 'offer')!;
    const bobOffer = bob.sent.find((s) => s.kind === 'offer')!;

    // Каждый получает чужой оффер, уже сделав свой.
    await alice.manager.handleOffer('bob', bobOffer.payload as never);
    await bob.manager.handleOffer('alice', aliceOffer.payload as never);

    // polite = selfId > peerId: 'bob' > 'alice' → уступает Боб.
    expect(bob.sent.filter((s) => s.kind === 'answer')).toHaveLength(1);
    expect(alice.sent.filter((s) => s.kind === 'answer')).toHaveLength(0);

    // Ответ Боба применяется у Алисы — соединение сходится.
    const answer = bob.sent.find((s) => s.kind === 'answer')!;
    await alice.manager.handleAnswer('bob', answer.payload as never);
    expect(alice.last().remoteDescription?.type).toBe('answer');
  });

  it('★ mesh из четырёх участников: 3 соединения на клиента, 6 на комнату', async () => {
    const me = harness({ selfId: 'me' });

    // Вошли третьим: двое уже в комнате (мы инициатор), четвёртый придёт после.
    me.manager.addPeer('peer-a', false);
    me.manager.addPeer('peer-b', false);
    await tick();
    me.manager.addPeer('peer-c', true);
    await tick();

    expect(me.manager.getPeerIds()).toHaveLength(3);
    // Офферы только тем, кто пришёл после нас (антиглэр).
    expect(me.sent.filter((s) => s.kind === 'offer').map((s) => s.to)).toEqual(['peer-c']);
    // Потоков столько же, сколько пиров — по одному на каждого.
    expect(me.streams).toHaveLength(3);
  });
});

describe('вызовы колбэков не ломают менеджер', () => {
  it('исключение в sendOffer не приводит к незакрытому соединению', async () => {
    const h = harness({
      sendOffer: () => {
        throw new Error('сокет уже закрыт');
      },
    });

    h.manager.addPeer('peer-1', true);
    await tick();

    // Ошибка ушла в onError, менеджер жив, соединение можно закрыть.
    expect(h.errors.length).toBeGreaterThan(0);
    expect(() => h.manager.closeAll()).not.toThrow();
  });

  it('onRemoteStream и onConnectionState необязательны', () => {
    const factory = fakePeerConnectionFactory();
    const manager = new PeerManager({
      selfId: 'self',
      createPeerConnection: factory.create,
      createMediaStream: createFakeMediaStream,
      sendOffer: vi.fn(),
      sendAnswer: vi.fn(),
      sendIce: vi.fn(),
    });

    expect(() => manager.addPeer('peer-1', false)).not.toThrow();
    manager.closeAll();
  });
});
