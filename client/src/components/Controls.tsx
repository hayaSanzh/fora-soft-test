/**
 * Панель управления комнатой (задачи IP 10.4, 10.5; ФТ-3, ФТ-15, ФТ-17, ФТ-27).
 *
 * Тумблеры показывают **текущее состояние**, а не только действие: кнопка
 * подписана действием («Выключить микрофон»), но при этом визуально отмечена
 * как активная и помечена `aria-pressed`. Иначе пользователь не понимает, в
 * каком состоянии устройство, — особенно при выключенной камере, когда картинки
 * нет вовсе.
 */
import { useState } from 'react';
import type { MediaState } from '@video-chat/shared';
import { copyLink } from '../lib/copyLink';
import { strings } from '../strings';

export interface ControlsProps {
  media: MediaState;
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onLeave: () => void;
  /** Ссылка-приглашение; по умолчанию — адрес текущей страницы (ФТ-3). */
  inviteLink?: string;
  /** Подменяется в тестах. */
  clipboard?: Pick<Clipboard, 'writeText'> | undefined;
}

export function Controls({
  media,
  onToggleMic,
  onToggleCamera,
  onLeave,
  inviteLink,
  clipboard,
}: ControlsProps) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');

  const handleCopy = async () => {
    const link = inviteLink ?? (typeof location !== 'undefined' ? location.href : '');
    // Результат обязан быть видимым: без подтверждения пользователь не знает,
    // скопировалась ли ссылка, и отправляет собеседнику пустоту (ФТ-3, US-3).
    setCopyState(await copyLink(link, { clipboard }));
  };

  return (
    <div className="controls" role="group" aria-label={strings.room.controls}>
      <button
        className={media.audio ? 'button button--on' : 'button button--off'}
        type="button"
        aria-pressed={media.audio}
        onClick={onToggleMic}
      >
        {media.audio ? strings.room.micOn : strings.room.micOff}
      </button>

      <button
        className={media.video ? 'button button--on' : 'button button--off'}
        type="button"
        aria-pressed={media.video}
        onClick={onToggleCamera}
      >
        {media.video ? strings.room.cameraOn : strings.room.cameraOff}
      </button>

      <button className="button" type="button" onClick={() => void handleCopy()}>
        {strings.room.copyLink}
      </button>

      <button className="button button--danger" type="button" onClick={onLeave}>
        {strings.room.leave}
      </button>

      {/* Подтверждение и запасной путь при отказе Clipboard API (задача 10.5). */}
      {copyState !== 'idle' && (
        <span
          className={copyState === 'copied' ? 'hint hint--ok' : 'hint hint--error'}
          role="status"
        >
          {copyState === 'copied' ? strings.room.copyLinkDone : strings.room.copyLinkFailed}
        </span>
      )}
    </div>
  );
}
