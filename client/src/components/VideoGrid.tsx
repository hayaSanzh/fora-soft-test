/**
 * Сетка видеоплиток (задача IP 10.3, ФТ-11, PRD §6, TDD §3.1, §4.8).
 *
 * Раскладки: 1 плитка — во всю ширину, 2 — рядом, 3–4 — сеткой 2×2. Целевые
 * экраны — десктоп от 1024px (мобильной адаптации нет по PRD §5), но сетка
 * остаётся читаемой и на меньшей ширине: колонки складываются в одну.
 *
 * Раскладка задаётся классом по числу участников, а не «умным» auto-fit:
 * при трёх участниках auto-fit дал бы 2 + 1 растянутую на всю ширину плитку,
 * а требуется предсказуемая 2×2 (ФТ-11 говорит «например, 2×2»).
 */
import type { Participant } from '@video-chat/shared';
import { VideoTile } from './VideoTile';

export interface VideoGridProps {
  participants: Participant[];
  selfId: string | null;
  peerConnectionStates: Record<string, RTCPeerConnectionState>;
  /** Стабильный по идентичности колбэк на участника — иначе `memo` бессмыслен. */
  attachVideo: (
    participantId: string,
    isSelf: boolean,
  ) => (element: HTMLVideoElement | null) => void;
}

/** Класс раскладки: 1 / 2 / 3–4 плитки. */
function layoutClass(count: number): string {
  if (count <= 1) return 'grid grid--single';
  if (count === 2) return 'grid grid--pair';
  return 'grid grid--quad';
}

export function VideoGrid({
  participants,
  selfId,
  peerConnectionStates,
  attachVideo,
}: VideoGridProps) {
  return (
    <div className={layoutClass(participants.length)}>
      {participants.map((participant) => {
        const isSelf = participant.id === selfId;
        return (
          <VideoTile
            key={participant.id}
            participant={participant}
            isSelf={isSelf}
            connectionState={peerConnectionStates[participant.id]}
            attachVideo={attachVideo(participant.id, isSelf)}
          />
        );
      })}
    </div>
  );
}
