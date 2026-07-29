/**
 * Оркестратор сессии в комнате (задача IP 9, TDD §4.6).
 *
 * Единственное место, где сходятся три независимых слоя:
 *
 * ```
 * LocalMedia (дорожки) ──► PeerManager (mesh) ──► RoomConnection (сигналинг)
 *          └────────────────── roomReducer (состояние UI) ◄──────┘
 * ```
 *
 * Ни один из этих модулей не знает про остальные: `LocalMedia` не знает про
 * WebRTC, `PeerManager` — про socket.io, `roomConnection` — про
 * `RTCPeerConnection`. Связывание живёт здесь и только здесь, поэтому его можно
 * проверить сквозным тестом на реальном сокете с фейковыми устройствами.
 *
 * Три обязанности:
 * 1. **Подписки** (9.1): `peer:joined` → создать соединение и отправить оффер;
 *    `peer:left` → закрыть соединение; `signal:*` → в `PeerManager`.
 * 2. **Дорожки и потоки вне состояния React** (9.2): `MediaStream` и
 *    `RTCPeerConnection` живут здесь, в обычных полях. В reducer уходит только
 *    факт появления или исчезновения участника — иначе видеосетка
 *    перерисовывалась бы на каждый ICE-кандидат.
 * 3. **Единый teardown** (9.3): выход, обрыв и размонтирование ведут в одну
 *    функцию, которая закрывает соединения, останавливает дорожки и разрывает
 *    сокет. `beforeunload` не нужен — socket.io сам присылает `disconnect`.
 */
import type { Dispatch } from 'react';
import type { MediaState } from '@video-chat/shared';
import type { MediaErrorKind, RoomAction } from '../state/roomReducer';
import { LocalMedia } from './localMedia';
import { PeerManager } from './PeerManager';
import { startRoomConnection, type RoomConnection } from './roomConnection';
import type { ClientSocket } from './socket';

export interface RoomSessionDeps {
  roomId: string;
  name: string;
  dispatch: Dispatch<RoomAction>;
  /** Битая ссылка: увести на стартовый экран. */
  onInvalidRoomId: () => void;

  /** Поток пира готов: UI присваивает `srcObject` **один раз** (TDD §4.5 нюанс 5). */
  onRemoteStream?: (peerId: string, stream: MediaStream) => void;
  /** Пир ушёл: UI может освободить элемент. */
  onRemoteStreamGone?: (peerId: string) => void;
  /** Своя видеодорожка для self-view. */
  onSelfVideoTrack?: (track: MediaStreamTrack | null) => void;
  /** Состояние своих устройств изменилось (для кнопок). */
  onMediaState?: (media: MediaState) => void;
  onMediaError?: (kind: MediaErrorKind | null) => void;

  // ── Фабрики: подменяются в тестах ──────────────────────────────────────────
  mediaDevices?: MediaDevices;
  createSocketFn?: () => ClientSocket;
  createPeerConnection?: (configuration: RTCConfiguration) => RTCPeerConnection;
  createMediaStream?: () => MediaStream;
  timeoutMs?: number;
}

export interface RoomSession {
  toggleMic: () => void;
  toggleCamera: () => void;
  getMediaState: () => MediaState;
  getRemoteStream: (peerId: string) => MediaStream | undefined;
  getPeerIds: () => string[];
  /** Осознанный выход участника (ФТ-27). */
  leave: () => void;
  /** Единый teardown: выход, обрыв, размонтирование (9.3). Идемпотентен. */
  teardown: () => void;
}

export function startRoomSession(deps: RoomSessionDeps): RoomSession {
  const { dispatch } = deps;

  /** ★ 9.2: потоки живут здесь, а не в состоянии React. */
  const remoteStreams = new Map<string, MediaStream>();
  let connection: RoomConnection | null = null;
  let disposed = false;

  // ── Медиа ──────────────────────────────────────────────────────────────────
  const local = new LocalMedia({
    ...(deps.mediaDevices ? { mediaDevices: deps.mediaDevices } : {}),
    // Дорожки уходят во все соединения разом — без ренегоциации (TDD §7.3).
    onAudioTrack: (track) => void peerManager.replaceOutgoingAudio(track),
    onVideoTrack: (track) => {
      void peerManager.replaceOutgoingVideo(track);
      deps.onSelfVideoTrack?.(track);
    },
    onStateChange: (state) => {
      dispatch({ type: 'SELF_MEDIA', media: state });
      // Явное событие — единственный источник истины для заглушек у остальных.
      connection?.setMediaState(state);
      deps.onMediaState?.(state);
    },
    onError: (kind) => {
      // Ошибка медиа никогда не терминальна (ФТ-33, TDD §8.3).
      if (kind) dispatch({ type: 'MEDIA_FAILED', kind });
      deps.onMediaError?.(kind);
    },
  });

  // ── Mesh ───────────────────────────────────────────────────────────────────
  const peerManager = new PeerManager({
    // Настоящий `selfId` приходит в ack `room:join`; до этого соединений нет.
    selfId: '',
    ...(deps.createPeerConnection ? { createPeerConnection: deps.createPeerConnection } : {}),
    ...(deps.createMediaStream ? { createMediaStream: deps.createMediaStream } : {}),
    getLocalTracks: () => ({ audio: local.getAudioTrack(), video: local.getVideoTrack() }),
    sendOffer: (to, sdp) => connection?.sendOffer(to, sdp),
    sendAnswer: (to, sdp) => connection?.sendAnswer(to, sdp),
    sendIce: (to, candidate) => connection?.sendIce(to, candidate),
    onRemoteStream: (peerId, stream) => {
      remoteStreams.set(peerId, stream);
      deps.onRemoteStream?.(peerId, stream);
    },
    onConnectionState: (peerId, state) => {
      // Состояние нужно для индикации на плитке (Q9, ФТ-34). Это единственное
      // WebRTC-событие, попадающее в состояние UI: оно меняется редко.
      dispatch({ type: 'PEER_CONNECTION_STATE', id: peerId, state });
    },
  });

  /** ★ 9.3: единственный путь освобождения ресурсов. */
  const releaseMedia = (): void => {
    // Порядок важен: сначала перестаём отправлять, потом гасим устройства.
    peerManager.closeAll();
    local.teardown();
    for (const peerId of remoteStreams.keys()) deps.onRemoteStreamGone?.(peerId);
    remoteStreams.clear();
  };

  // ── Запуск ─────────────────────────────────────────────────────────────────
  /**
   * Сначала устройства, потом сокет: в `room:join` уходит фактическое состояние
   * медиа, чтобы остальные сразу увидели верные заглушки (ФТ-14, ФТ-18).
   */
  void local.acquire().then((media) => {
    if (disposed) return;

    // Обе ветки ведут в `connecting`: отказ в доступе не терминален.
    dispatch({ type: 'MEDIA_READY' });

    connection = startRoomConnection({
      roomId: deps.roomId,
      name: deps.name,
      media,
      dispatch,
      onInvalidRoomId: deps.onInvalidRoomId,
      teardownMedia: releaseMedia,
      ...(deps.createSocketFn ? { createSocketFn: deps.createSocketFn } : {}),
      ...(deps.timeoutMs !== undefined ? { timeoutMs: deps.timeoutMs } : {}),

      // ★ 9.1: вход состоялся — создаём соединения с теми, кто уже в комнате.
      // Инициаторами будут они, мы только отвечаем (антиглэр, TDD §4.5).
      onJoined: (selfId, participants) => {
        peerManager.setSelfId(selfId);
        for (const participant of participants) {
          if (participant.id === selfId) continue;
          peerManager.addPeer(participant.id, false);
        }
      },

      // Новый участник: инициатор — мы, потому что были в комнате раньше.
      onPeerJoined: (participant) => peerManager.addPeer(participant.id, true),

      onPeerLeft: (peerId) => {
        peerManager.closePeer(peerId);
        remoteStreams.delete(peerId);
        deps.onRemoteStreamGone?.(peerId);
      },

      onOffer: (from, sdp) => void peerManager.handleOffer(from, sdp),
      onAnswer: (from, sdp) => void peerManager.handleAnswer(from, sdp),
      onIce: (from, candidate) => void peerManager.handleIce(from, candidate),
    });
  });

  return {
    toggleMic: () => void local.setMicEnabled(!local.state.audio),
    toggleCamera: () => void local.setCameraEnabled(!local.state.video),
    getMediaState: () => local.state,
    getRemoteStream: (peerId) => remoteStreams.get(peerId),
    getPeerIds: () => peerManager.getPeerIds(),

    leave: () => {
      if (disposed) return;
      disposed = true;
      // `leave()` сам вызовет `teardownMedia` через соединение.
      if (connection) connection.leave();
      else {
        releaseMedia();
        dispatch({ type: 'LEFT' });
      }
    },

    teardown: () => {
      if (disposed) return;
      disposed = true;
      // Сокет ещё мог не создаться (пользователь ушёл во время getUserMedia).
      if (connection) connection.dispose();
      else releaseMedia();
    },
  };
}
