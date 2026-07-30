/**
 * `PeerManager` — ядро mesh WebRTC (задача IP 8, TDD §4.5).
 *
 * Обычный класс без зависимости от React: он не должен вызывать ре-рендер на
 * каждый ICE-кандидат (TDD §3.2, §9.3) и обязан тестироваться в изоляции с
 * мокнутым `RTCPeerConnection`.
 *
 * Семь нюансов, каждый из которых — источник трудноуловимых дефектов:
 *
 * 1. **Фиксированные трансиверы.** При создании соединения всегда добавляются
 *    ровно два трансивера в детерминированном порядке (`audio`, затем `video`).
 *    Это даёт одинаковую форму SDP независимо от наличия устройств и убирает
 *    ренегоциацию при включении камеры.
 * 2. **Антиглэр по роли.** Оффер отправляет только тот, кто **уже был** в
 *    комнате; новичок создаёт соединения по списку из ack и лишь отвечает.
 *    Иначе оба конца отправят оффер одновременно — один оффер на пару.
 * 3. **Perfect negotiation** как страховка: `polite = selfId > peerId`.
 * 4. **Буфер ICE-кандидатов**: кандидат может прийти раньше SDP.
 * 5. **Один `MediaStream` на пира**, создаётся вместе с соединением и не
 *    пересоздаётся — иначе `srcObject` приходится присваивать заново, и видео
 *    мигает.
 * 6. **Ошибка одного соединения не терминальна**: одна попытка `restartIce()`,
 *    затем пометка конкретной плитки. Остальные соединения и чат живут.
 * 7. **Детерминированный teardown**: `closePeer` идемпотентен, потому что
 *    `peer:left` может прийти раньше, чем соединение установилось.
 */
import type { IceCandidateData, SdpDescription } from '@video-chat/shared';
import { config } from '../config';

export interface PeerManagerCallbacks {
  /** Отправить оффер адресату (уйдёт событием `signal:offer`). */
  sendOffer: (to: string, sdp: SdpDescription) => void;
  sendAnswer: (to: string, sdp: SdpDescription) => void;
  sendIce: (to: string, candidate: IceCandidateData) => void;
  /**
   * Поток пира. Вызывается **один раз** при создании соединения: сам объект
   * потока не меняется, дорожки добавляются в него по мере прихода (нюанс 5).
   */
  onRemoteStream?: (peerId: string, stream: MediaStream) => void;
  /** Состояние соединения — для индикации на плитке (Q9, ФТ-34). */
  onConnectionState?: (peerId: string, state: RTCPeerConnectionState) => void;
  /** Диагностика без пользовательских данных. */
  onError?: (peerId: string, error: unknown) => void;
}

export interface PeerManagerOptions extends PeerManagerCallbacks {
  /** Собственный `socket.id`: нужен для вычисления роли в perfect negotiation. */
  selfId: string;
  /** Локальные дорожки на момент создания соединения. */
  getLocalTracks?: () => { audio: MediaStreamTrack | null; video: MediaStreamTrack | null };
  /** Подменяется в тестах (в Node нет `RTCPeerConnection`). */
  createPeerConnection?: (configuration: RTCConfiguration) => RTCPeerConnection;
  /** Подменяется в тестах (в Node нет `MediaStream`). */
  createMediaStream?: () => MediaStream;
  /**
   * Потолок исходящего видеобитрейта, бит/с (Q5). По умолчанию берётся из
   * конфигурации, где он выключен. Вынесен в опции, чтобы **включённое**
   * состояние можно было проверить тестом: это единственная мера против
   * упирания в канал на четырёх участниках (риск R2), и она обязана работать не
   * только на словах.
   */
  maxVideoBitrate?: number | null;
}

interface PeerEntry {
  pc: RTCPeerConnection;
  audioSender: RTCRtpSender;
  videoSender: RTCRtpSender;
  /** Один на пира, создаётся сразу и не пересоздаётся (нюанс 5). */
  remoteStream: MediaStream;
  /** Роль в perfect negotiation: вежливый уступает при коллизии (нюанс 3). */
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  /**
   * Право инициировать оффер. Новичок получает его только после первого
   * применённого удалённого описания — это и есть антиглэр (нюанс 2).
   */
  canOffer: boolean;
  /** Кандидаты, пришедшие раньше SDP (нюанс 4). */
  pendingCandidates: IceCandidateData[];
  /** `restartIce()` пробуется один раз на соединение (нюанс 6). */
  iceRestartsLeft: number;
  closed: boolean;
}

export class PeerManager {
  private readonly peers = new Map<string, PeerEntry>();
  private readonly callbacks: PeerManagerCallbacks;
  private readonly createPeerConnection: (configuration: RTCConfiguration) => RTCPeerConnection;
  private readonly createMediaStream: () => MediaStream;
  private readonly getLocalTracks: () => {
    audio: MediaStreamTrack | null;
    video: MediaStreamTrack | null;
  };
  /** Потолок исходящего видеобитрейта, бит/с; `null` — без ограничения (Q5). */
  private readonly maxVideoBitrate: number | null;
  private selfId: string;

  constructor(options: PeerManagerOptions) {
    this.callbacks = options;
    this.selfId = options.selfId;
    this.createPeerConnection =
      options.createPeerConnection ?? ((configuration) => new RTCPeerConnection(configuration));
    this.createMediaStream = options.createMediaStream ?? (() => new MediaStream());
    this.getLocalTracks = options.getLocalTracks ?? (() => ({ audio: null, video: null }));
    this.maxVideoBitrate = options.maxVideoBitrate ?? config.maxVideoBitrate;
  }

  /** `selfId` известен только после ack `room:join`. */
  setSelfId(selfId: string): void {
    this.selfId = selfId;
  }

  getPeerIds(): string[] {
    return [...this.peers.keys()];
  }

  getRemoteStream(peerId: string): MediaStream | undefined {
    return this.peers.get(peerId)?.remoteStream;
  }

  /**
   * Создаёт соединение с участником (задачи 8.1–8.3).
   *
   * @param initiator `true` — мы уже были в комнате и отправляем оффер;
   *                  `false` — мы новичок и только отвечаем (нюанс 2).
   */
  addPeer(peerId: string, initiator: boolean): void {
    if (peerId === this.selfId) return; // соединение с самим собой не нужно
    if (this.peers.has(peerId)) return; // идемпотентность: повторный peer:joined

    const pc = this.createPeerConnection({
      iceServers: [...config.iceServers],
      iceCandidatePoolSize: config.iceCandidatePoolSize,
    });

    // ★ Нюанс 1: ровно два трансивера в фиксированном порядке. Порядок важен —
    // он определяет порядок m-строк в SDP и должен совпадать у обоих концов.
    const audioSender = pc.addTransceiver('audio', { direction: 'sendrecv' }).sender;
    const videoSender = pc.addTransceiver('video', { direction: 'sendrecv' }).sender;

    const entry: PeerEntry = {
      pc,
      audioSender,
      videoSender,
      remoteStream: this.createMediaStream(),
      // ★ Нюанс 3: роль вычисляется детерминированно из идентификаторов,
      // поэтому обе стороны приходят к одному и тому же решению.
      polite: this.selfId > peerId,
      makingOffer: false,
      ignoreOffer: false,
      canOffer: initiator,
      pendingCandidates: [],
      iceRestartsLeft: config.iceRestartAttempts,
      closed: false,
    };
    this.peers.set(peerId, entry);

    this.attachHandlers(peerId, entry);
    // Поток отдаётся наружу сразу: UI присвоит `srcObject` один раз (нюанс 5).
    this.callbacks.onRemoteStream?.(peerId, entry.remoteStream);

    // Дорожки подставляются в уже существующие senders — без ренегоциации.
    const tracks = this.getLocalTracks();
    void this.applyTrack(entry, 'audio', tracks.audio);
    void this.applyTrack(entry, 'video', tracks.video);
  }

  /** Закрывает соединение (задача 8.9). Идемпотентен. */
  closePeer(peerId: string): void {
    const entry = this.peers.get(peerId);
    if (!entry) return;
    this.peers.delete(peerId);
    if (entry.closed) return;
    entry.closed = true;

    // Порядок детерминирован: снять обработчики → отпустить дорожки → закрыть.
    // Обработчики снимаются первыми, иначе `pc.close()` вызовет
    // `onconnectionstatechange` и наружу уйдёт состояние уже мёртвого пира.
    entry.pc.onicecandidate = null;
    entry.pc.ontrack = null;
    entry.pc.onnegotiationneeded = null;
    entry.pc.onconnectionstatechange = null;
    entry.pc.oniceconnectionstatechange = null;

    for (const sender of entry.pc.getSenders()) {
      // `replaceTrack(null)` — не `removeTrack` (риск R4).
      void sender.replaceTrack(null).catch(() => undefined);
    }
    entry.pc.close();
  }

  /** Закрывает все соединения: выход, обрыв, размонтирование (ФТ-27, R7). */
  closeAll(): void {
    for (const peerId of this.getPeerIds()) this.closePeer(peerId);
  }

  // ── Сигналинг ──────────────────────────────────────────────────────────────

  /** Входящий оффер (задачи 8.3, 8.5). */
  async handleOffer(from: string, sdp: SdpDescription): Promise<void> {
    const entry = this.peers.get(from);
    if (!entry || entry.closed) return;

    // ★ Нюанс 3: коллизия — мы сами делаем оффер или соединение не в stable.
    const collision = entry.makingOffer || entry.pc.signalingState !== 'stable';
    entry.ignoreOffer = !entry.polite && collision;
    if (entry.ignoreOffer) {
      // Невежливый отбрасывает чужой оффер: вежливый уступит и примет наш.
      return;
    }

    try {
      await entry.pc.setRemoteDescription(sdp);
      await this.flushCandidates(from, entry);

      // Ответ формируется без аргументов: браузер сам подберёт корректный тип.
      await entry.pc.setLocalDescription();
      const answer = entry.pc.localDescription;
      if (answer) this.callbacks.sendAnswer(from, answer);

      // После первого удалённого описания право на оффер появляется и у новичка:
      // дальнейшая ренегоциация (если понадобится) пойдёт по perfect negotiation.
      entry.canOffer = true;
    } catch (error) {
      this.callbacks.onError?.(from, error);
    }
  }

  /** Входящий ответ (задача 8.3). */
  async handleAnswer(from: string, sdp: SdpDescription): Promise<void> {
    const entry = this.peers.get(from);
    if (!entry || entry.closed) return;

    try {
      await entry.pc.setRemoteDescription(sdp);
      await this.flushCandidates(from, entry);
    } catch (error) {
      this.callbacks.onError?.(from, error);
    }
  }

  /**
   * Входящий ICE-кандидат (задача 8.4).
   *
   * ★ Нюанс 4: кандидат может прийти раньше SDP — тогда `addIceCandidate`
   * бросает исключение. Буферизуем до `setRemoteDescription` и сбрасываем
   * сразу после него.
   */
  async handleIce(from: string, candidate: IceCandidateData): Promise<void> {
    const entry = this.peers.get(from);
    if (!entry || entry.closed) return;

    if (entry.pc.remoteDescription === null) {
      entry.pendingCandidates.push(candidate);
      return;
    }

    try {
      await entry.pc.addIceCandidate(candidate);
    } catch (error) {
      // Кандидаты отброшенного оффера бесполезны — это не ошибка (нюанс 3).
      if (!entry.ignoreOffer) this.callbacks.onError?.(from, error);
    }
  }

  // ── Локальные дорожки (задача 8.8) ─────────────────────────────────────────

  /** Подставляет исходящую аудиодорожку во все соединения разом. */
  async replaceOutgoingAudio(track: MediaStreamTrack | null): Promise<void> {
    await Promise.all(
      [...this.peers.values()].map((entry) => this.applyTrack(entry, 'audio', track)),
    );
  }

  /**
   * Подставляет исходящую видеодорожку во все соединения разом.
   *
   * Именно это делает тумблер камеры бесплатным: m-строка и трансивер остаются
   * на месте, ренегоциации нет (риск R4).
   */
  async replaceOutgoingVideo(track: MediaStreamTrack | null): Promise<void> {
    await Promise.all(
      [...this.peers.values()].map((entry) => this.applyTrack(entry, 'video', track)),
    );
  }

  // ── Внутреннее ─────────────────────────────────────────────────────────────

  private attachHandlers(peerId: string, entry: PeerEntry): void {
    const { pc } = entry;

    // Trickle ICE: кандидаты уходят по мере появления, не дожидаясь конца сбора.
    pc.onicecandidate = (event) => {
      if (!event.candidate || entry.closed) return;
      this.callbacks.sendIce(peerId, event.candidate.toJSON());
    };

    // ★ Нюанс 5: дорожка добавляется в существующий поток, а не создаётся новый.
    pc.ontrack = (event) => {
      if (entry.closed) return;
      const [track] = event.track ? [event.track] : [];
      if (track) entry.remoteStream.addTrack(track);
    };

    // ★ Нюанс 2 + 3: оффер отправляет только тот, кто имеет на это право.
    pc.onnegotiationneeded = () => {
      if (entry.closed || !entry.canOffer) return;
      // ★ Защита от повторного оффера. Спецификация обещает, что событие
      // приходит только в состоянии `stable`, но полагаться на это нельзя:
      // добавление двух трансиверов подряд может дать два события, и тогда на
      // пару уходит два оффера — гарантированный glare. Проверка состояния
      // здесь стоит один if, а отладка «иногда видео не появляется» — дни.
      if (entry.makingOffer || pc.signalingState !== 'stable') return;
      void this.makeOffer(peerId, entry);
    };

    pc.onconnectionstatechange = () => {
      if (entry.closed) return;
      const state = pc.connectionState;
      this.callbacks.onConnectionState?.(peerId, state);

      // ★ Нюанс 6: одна попытка перезапуска ICE, дальше — пометка плитки.
      // Остальные соединения и чат продолжают работать (ФТ-34, риск R1).
      if (state === 'failed' && entry.iceRestartsLeft > 0) {
        entry.iceRestartsLeft -= 1;
        try {
          pc.restartIce();
        } catch (error) {
          this.callbacks.onError?.(peerId, error);
        }
      }
    };
  }

  /** Формирует и отправляет оффер (задача 8.5). */
  private async makeOffer(peerId: string, entry: PeerEntry): Promise<void> {
    entry.makingOffer = true;
    try {
      // `setLocalDescription()` без аргументов: браузер сам создаст оффер
      // нужного типа. Это и есть рекомендованный perfect negotiation.
      await entry.pc.setLocalDescription();
      const offer = entry.pc.localDescription;
      if (offer && !entry.closed) this.callbacks.sendOffer(peerId, offer);
    } catch (error) {
      this.callbacks.onError?.(peerId, error);
    } finally {
      entry.makingOffer = false;
    }
  }

  /** Применяет отложенные ICE-кандидаты (задача 8.4). */
  private async flushCandidates(peerId: string, entry: PeerEntry): Promise<void> {
    const pending = entry.pendingCandidates.splice(0);
    for (const candidate of pending) {
      try {
        await entry.pc.addIceCandidate(candidate);
      } catch (error) {
        this.callbacks.onError?.(peerId, error);
      }
    }
  }

  /** Подставляет дорожку в соответствующий sender и применяет потолок битрейта. */
  private async applyTrack(
    entry: PeerEntry,
    kind: 'audio' | 'video',
    track: MediaStreamTrack | null,
  ): Promise<void> {
    if (entry.closed) return;
    const sender = kind === 'audio' ? entry.audioSender : entry.videoSender;
    try {
      await sender.replaceTrack(track);
      if (kind === 'video' && track) this.applyVideoBitrate(sender);
    } catch (error) {
      this.callbacks.onError?.('', error);
    }
  }

  /**
   * Потолок битрейта (Q5, TDD §9.3). По умолчанию выключен: PRD качество не
   * нормирует. Включается флагом по результатам замеров на 4 участниках.
   */
  private applyVideoBitrate(sender: RTCRtpSender): void {
    const maxBitrate = this.maxVideoBitrate;
    if (maxBitrate === null) return;
    try {
      const parameters = sender.getParameters();
      parameters.encodings = (parameters.encodings ?? [{}]).map((encoding) => ({
        ...encoding,
        maxBitrate,
      }));
      void sender.setParameters(parameters).catch(() => undefined);
    } catch {
      // Старые реализации могут не поддерживать setParameters до негоциации —
      // потолок битрейта не критичен, молча пропускаем.
    }
  }
}
