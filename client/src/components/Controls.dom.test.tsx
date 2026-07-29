/**
 * Компонентные тесты панели управления (задача IP 12, дополнение к 10.4–10.5;
 * ФТ-3, ФТ-15, ФТ-17, ФТ-27, US-3).
 *
 * В плане группы 12 этого файла нет, но здесь остался единственный участок UI с
 * **асинхронным состоянием после клика**: подтверждение копирования ссылки
 * появляется только после того, как разрешится промис Clipboard API. Разметка
 * при фиксированных пропсах его не показывает вовсе, а именно этот путь
 * пользователь проходит при каждом приглашении собеседника.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Controls } from './Controls';
import { strings } from '../strings';

afterEach(cleanup);

const noop = () => undefined;
const base = { onToggleMic: noop, onToggleCamera: noop, onLeave: noop };

describe('12 Controls: тумблеры (ФТ-15, ФТ-17)', () => {
  it('★ клики по тумблерам вызывают ровно свои обработчики', async () => {
    const user = userEvent.setup();
    const onToggleMic = vi.fn();
    const onToggleCamera = vi.fn();
    const onLeave = vi.fn();
    render(
      <Controls
        media={{ audio: true, video: true }}
        onToggleMic={onToggleMic}
        onToggleCamera={onToggleCamera}
        onLeave={onLeave}
        clipboard={undefined}
      />,
    );

    await user.click(screen.getByRole('button', { name: strings.room.micOn }));
    await user.click(screen.getByRole('button', { name: strings.room.cameraOn }));

    expect(onToggleMic).toHaveBeenCalledTimes(1);
    expect(onToggleCamera).toHaveBeenCalledTimes(1);
    expect(onLeave).not.toHaveBeenCalled();
  });

  it('★ состояние устройства читается и подписью, и aria-pressed', () => {
    const { rerender } = render(
      <Controls {...base} media={{ audio: true, video: false }} clipboard={undefined} />,
    );

    expect(screen.getByRole('button', { name: strings.room.micOn })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: strings.room.cameraOff })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    rerender(<Controls {...base} media={{ audio: false, video: true }} clipboard={undefined} />);

    expect(screen.getByRole('button', { name: strings.room.micOff })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('★ «Выйти» вызывает выход (ФТ-27)', async () => {
    const user = userEvent.setup();
    const onLeave = vi.fn();
    render(
      <Controls
        {...base}
        media={{ audio: true, video: true }}
        onLeave={onLeave}
        clipboard={undefined}
      />,
    );

    await user.click(screen.getByRole('button', { name: strings.room.leave }));

    expect(onLeave).toHaveBeenCalledTimes(1);
  });
});

describe('12 ★ Controls: копирование ссылки (ФТ-3, US-3)', () => {
  it('★ подтверждение появляется только ПОСЛЕ успешного копирования', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(() => Promise.resolve());
    render(
      <Controls
        {...base}
        media={{ audio: true, video: true }}
        inviteLink="http://localhost:3001/RoomAAAAAAAA"
        clipboard={{ writeText }}
      />,
    );

    // До клика подтверждения нет.
    expect(screen.queryByText(strings.room.copyLinkDone)).toBeNull();

    await user.click(screen.getByRole('button', { name: strings.room.copyLink }));

    expect(writeText).toHaveBeenCalledWith('http://localhost:3001/RoomAAAAAAAA');
    expect(await screen.findByText(strings.room.copyLinkDone)).toBeInTheDocument();
  });

  it('★ отказ буфера обмена: подсказка скопировать вручную, без падения', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(() => Promise.reject(new Error('NotAllowedError')));
    render(
      <Controls
        {...base}
        media={{ audio: true, video: true }}
        inviteLink="http://localhost:3001/RoomAAAAAAAA"
        clipboard={{ writeText }}
      />,
    );

    await user.click(screen.getByRole('button', { name: strings.room.copyLink }));

    expect(await screen.findByText(strings.room.copyLinkFailed)).toBeInTheDocument();
    expect(screen.queryByText(strings.room.copyLinkDone)).toBeNull();
  });

  it('★ без явной зависимости используется настоящий navigator.clipboard', async () => {
    // Так работает продакшен-путь: `copyLink` берёт `navigator.clipboard`, если
    // зависимость не передана. В jsdom буфер обмена подставляет `userEvent`.
    //
    // Случай «Clipboard API отсутствует вовсе» (страница без HTTPS) здесь не
    // воспроизводим — `userEvent.setup()` всегда ставит заглушку; он покрыт
    // unit-тестом `copyLink` в `roomUi.test.tsx`.
    const user = userEvent.setup();
    render(
      <Controls
        {...base}
        media={{ audio: true, video: true }}
        inviteLink="http://localhost:3001/RoomBBBBBBBB"
      />,
    );

    await user.click(screen.getByRole('button', { name: strings.room.copyLink }));

    expect(await screen.findByText(strings.room.copyLinkDone)).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toBe('http://localhost:3001/RoomBBBBBBBB');
  });

  it('★ подтверждение объявляется скринридеру (role=status)', async () => {
    const user = userEvent.setup();
    render(
      <Controls
        {...base}
        media={{ audio: true, video: true }}
        inviteLink="http://localhost:3001/RoomAAAAAAAA"
        clipboard={{ writeText: () => Promise.resolve() }}
      />,
    );

    await user.click(screen.getByRole('button', { name: strings.room.copyLink }));

    expect(await screen.findByRole('status')).toHaveTextContent(strings.room.copyLinkDone);
  });
});
