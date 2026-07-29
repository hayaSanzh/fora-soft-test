/**
 * Мок `RTCPeerConnection` для тестов `PeerManager` (задача IP 8.10).
 *
 * Мок намеренно моделирует **машину состояний** реального API, а не просто
 * записывает вызовы: `signalingState`, отказ `addIceCandidate` до
 * `setRemoteDescription`, генерация SDP через `setLocalDescription()` без
 * аргументов. Иначе тест на буферизацию кандидатов или на perfect negotiation
 * проверял бы сам мок, а не реализацию.
 *
 * В Node нет ни `RTCPeerConnection`, ни `MediaStream`, поэтому оба заменяются.
 */

export interface FakeTrackLike {
  kind: string;
  id: string;
}

/** Минимальный `MediaStream`: только `addTrack` и перечисление дорожек. */
export class FakeMediaStream {
  readonly tracks: FakeTrackLike[] = [];

  addTrack(track: FakeTrackLike): void {
    this.tracks.push(track);
  }

  getTracks(): FakeTrackLike[] {
    return this.tracks;
  }
}

export class FakeSender {
  track: FakeTrackLike | null = null;
  readonly replaceCalls: (FakeTrackLike | null)[] = [];
  private parameters: RTCRtpSendParameters = { encodings: [{}] } as RTCRtpSendParameters;
  readonly setParametersCalls: RTCRtpSendParameters[] = [];

  constructor(public readonly kind: 'audio' | 'video') {}

  replaceTrack(track: FakeTrackLike | null): Promise<void> {
    this.replaceCalls.push(track);
    this.track = track;
    return Promise.resolve();
  }

  getParameters(): RTCRtpSendParameters {
    return this.parameters;
  }

  setParameters(parameters: RTCRtpSendParameters): Promise<void> {
    this.parameters = parameters;
    this.setParametersCalls.push(parameters);
    return Promise.resolve();
  }
}

export interface FakePeerConnectionOptions {
  /** Ошибка, которой отвечает `setRemoteDescription` (проверка обработки сбоев). */
  failSetRemoteDescription?: Error;
}

let sdpCounter = 0;

/**
 * Мок соединения. Поддерживает ровно тот набор поведения, на который опирается
 * `PeerManager`, включая последствия неверного порядка вызовов.
 */
export class FakePeerConnection {
  readonly transceivers: { kind: string; direction: string; sender: FakeSender }[] = [];
  readonly addedCandidates: RTCIceCandidateInit[] = [];
  readonly restartIceCalls: number[] = [];

  signalingState: RTCSignalingState = 'stable';
  connectionState: RTCPeerConnectionState = 'new';
  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  closed = false;

  onicecandidate: ((event: { candidate: { toJSON: () => unknown } | null }) => void) | null = null;
  ontrack: ((event: { track: FakeTrackLike }) => void) | null = null;
  onnegotiationneeded: (() => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  oniceconnectionstatechange: (() => void) | null = null;

  constructor(
    public readonly configuration: RTCConfiguration,
    private readonly options: FakePeerConnectionOptions = {},
  ) {}

  addTransceiver(kind: string, init: { direction: string }): { sender: FakeSender } {
    const sender = new FakeSender(kind as 'audio' | 'video');
    this.transceivers.push({ kind, direction: init.direction, sender });
    // Реальный браузер после добавления трансивера просит негоциацию.
    queueMicrotask(() => this.onnegotiationneeded?.());
    return { sender };
  }

  getSenders(): FakeSender[] {
    return this.transceivers.map((t) => t.sender);
  }

  /** Без аргументов: тип определяется состоянием, как в браузере. */
  setLocalDescription(description?: RTCSessionDescriptionInit): Promise<void> {
    const type =
      description?.type ?? (this.remoteDescription?.type === 'offer' ? 'answer' : 'offer');
    this.localDescription = { type, sdp: `v=0\r\nsdp-${++sdpCounter}\r\n` };
    this.signalingState = type === 'offer' ? 'have-local-offer' : 'stable';
    return Promise.resolve();
  }

  setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void> {
    if (this.options.failSetRemoteDescription) {
      return Promise.reject(this.options.failSetRemoteDescription);
    }
    this.remoteDescription = description;
    this.signalingState = description.type === 'offer' ? 'have-remote-offer' : 'stable';
    return Promise.resolve();
  }

  /** ★ Как в браузере: до `setRemoteDescription` кандидат добавить нельзя. */
  addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (this.remoteDescription === null) {
      return Promise.reject(new Error('InvalidStateError: remote description is null'));
    }
    this.addedCandidates.push(candidate);
    return Promise.resolve();
  }

  restartIce(): void {
    this.restartIceCalls.push(Date.now());
  }

  close(): void {
    this.closed = true;
    this.signalingState = 'closed';
  }

  // ── Помощники для тестов ───────────────────────────────────────────────────

  /** Эмулирует локальный ICE-кандидат от браузера. */
  emitIceCandidate(candidate: Record<string, unknown> | null): void {
    this.onicecandidate?.({
      candidate: candidate === null ? null : { toJSON: () => candidate },
    });
  }

  /** Эмулирует приход удалённой дорожки. */
  emitTrack(track: FakeTrackLike): void {
    this.ontrack?.({ track });
  }

  /** Эмулирует смену состояния соединения. */
  emitConnectionState(state: RTCPeerConnectionState): void {
    this.connectionState = state;
    this.onconnectionstatechange?.();
  }

  emitNegotiationNeeded(): void {
    this.onnegotiationneeded?.();
  }
}

/**
 * Фабрика соединений для одного `PeerManager`.
 *
 * Реестр созданных соединений **локален для фабрики**, а не статичен: со
 * статическим списком тест на двух менеджерах брал бы соединения соседа —
 * именно на этом мой первый вариант стенда и упал.
 */
export function fakePeerConnectionFactory(options: FakePeerConnectionOptions = {}) {
  const instances: FakePeerConnection[] = [];
  return {
    create: (configuration: RTCConfiguration) => {
      const pc = new FakePeerConnection(configuration, options);
      instances.push(pc);
      return pc as unknown as RTCPeerConnection;
    },
    instances,
    last: () => instances[instances.length - 1],
  };
}

export const createFakeMediaStream = () => new FakeMediaStream() as unknown as MediaStream;

export const fakeTrack = (kind: 'audio' | 'video', id = `${kind}-1`): MediaStreamTrack =>
  ({ kind, id }) as unknown as MediaStreamTrack;
