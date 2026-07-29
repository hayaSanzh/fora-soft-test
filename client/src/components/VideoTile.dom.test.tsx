/**
 * Компонентные тесты плитки участника (задача IP 12.2, ФТ-12, ФТ-16, ФТ-18).
 *
 * ★ Этот файл существует ради одного свойства, которое нельзя проверить
 * разметкой при фиксированных пропсах: элемент `<video>` должен оставаться **тем
 * же узлом DOM** при выключении и включении камеры (риск R5, TDD §4.7).
 *
 * Почему это критично: `{hasVideo && <video/>}` выглядит естественно и проходит
 * любую проверку разметки — но при выключении камеры собеседника размонтирует
 * элемент и **вместе с картинкой убьёт его звук**. Здесь проверяется
 * тождественность узла и то, что `ref` не вызывался заново.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { Participant } from '@video-chat/shared';
import { VideoTile } from './VideoTile';
import { strings } from '../strings';

afterEach(cleanup);

const participant = (audio: boolean, video: boolean, name = 'Борис'): Participant => ({
  id: 'peer-1',
  name,
  media: { audio, video },
  joinedAt: 1_769_000_000_000,
});

const videoNode = (container: HTMLElement) => container.querySelector('video');

describe('12.2 ★ <video> не размонтируется никогда (риск R5)', () => {
  it('★ элемент присутствует в DOM при выключенном видео', () => {
    const { container } = render(
      <VideoTile
        participant={participant(true, false)}
        isSelf={false}
        attachVideo={() => undefined}
      />,
    );

    expect(videoNode(container)).not.toBeNull();
  });

  it('★ при выключении камеры остаётся ТОТ ЖЕ узел DOM', () => {
    const props = { isSelf: false, attachVideo: () => undefined };
    const { container, rerender } = render(
      <VideoTile participant={participant(true, true)} {...props} />,
    );
    const before = videoNode(container);

    rerender(<VideoTile participant={participant(true, false)} {...props} />);

    expect(videoNode(container)).toBe(before);
  });

  it('★ ref не вызывается заново: элемент не пересоздавался', () => {
    const attachVideo = vi.fn();
    const { rerender } = render(
      <VideoTile participant={participant(true, true)} isSelf={false} attachVideo={attachVideo} />,
    );

    rerender(
      <VideoTile participant={participant(true, false)} isSelf={false} attachVideo={attachVideo} />,
    );
    rerender(
      <VideoTile participant={participant(true, true)} isSelf={false} attachVideo={attachVideo} />,
    );

    // Один вызов при монтировании — и ни одного `null`, то есть размонтирования
    // элемента не было ни при выключении камеры, ни при включении.
    expect(attachVideo).toHaveBeenCalledTimes(1);
    expect(attachVideo).not.toHaveBeenCalledWith(null);
  });

  it('★ ref получает настоящий <video>, а при размонтировании — null', () => {
    const attachVideo = vi.fn();
    const { unmount, container } = render(
      <VideoTile participant={participant(true, true)} isSelf={false} attachVideo={attachVideo} />,
    );

    expect(attachVideo).toHaveBeenCalledWith(videoNode(container));

    unmount();
    expect(attachVideo).toHaveBeenLastCalledWith(null);
  });
});

describe('12.2 оверлеи по состоянию устройств (ФТ-16, ФТ-18)', () => {
  it('★ заглушка с именем появляется и исчезает по props', () => {
    const props = { isSelf: false, attachVideo: () => undefined };
    const { rerender } = render(<VideoTile participant={participant(true, true)} {...props} />);

    expect(screen.queryByText('Борис', { selector: '.tile__placeholder-name' })).toBeNull();

    rerender(<VideoTile participant={participant(true, false)} {...props} />);
    expect(screen.getByText('Борис', { selector: '.tile__placeholder-name' })).toBeVisible();

    rerender(<VideoTile participant={participant(true, true)} {...props} />);
    expect(screen.queryByText('Борис', { selector: '.tile__placeholder-name' })).toBeNull();
  });

  it('★ иконка перечёркнутого микрофона появляется по props', () => {
    const props = { isSelf: false, attachVideo: () => undefined };
    const { rerender } = render(<VideoTile participant={participant(true, true)} {...props} />);

    expect(screen.queryByLabelText(strings.a11y.micMuted)).toBeNull();

    rerender(<VideoTile participant={participant(false, true)} {...props} />);
    expect(screen.getByLabelText(strings.a11y.micMuted)).toBeInTheDocument();
  });

  it('★ микрофон и камера независимы: оба оверлея сразу', () => {
    render(
      <VideoTile
        participant={participant(false, false)}
        isSelf={false}
        attachVideo={() => undefined}
      />,
    );

    expect(screen.getByLabelText(strings.a11y.micMuted)).toBeInTheDocument();
    expect(screen.getByText('Борис', { selector: '.tile__placeholder-name' })).toBeVisible();
  });
});

describe('12.2 ★ self-view заглушён, пиры — нет (ФТ-18, эхо)', () => {
  it('★ у себя свойство muted включено', () => {
    const { container } = render(
      <VideoTile participant={participant(true, true)} isSelf attachVideo={() => undefined} />,
    );

    // Именно свойство DOM, а не атрибут: React выставляет `muted` как property,
    // и в разметке его может не быть вовсе.
    expect(videoNode(container)).toHaveProperty('muted', true);
  });

  it('★ у пира muted выключен — иначе его не слышно (ФТ-19)', () => {
    const { container } = render(
      <VideoTile
        participant={participant(true, true)}
        isSelf={false}
        attachVideo={() => undefined}
      />,
    );

    expect(videoNode(container)).toHaveProperty('muted', false);
  });

  it('★ переключение камеры не снимает muted у себя', () => {
    const props = { isSelf: true, attachVideo: () => undefined };
    const { container, rerender } = render(
      <VideoTile participant={participant(true, true)} {...props} />,
    );

    rerender(<VideoTile participant={participant(true, false)} {...props} />);

    expect(videoNode(container)).toHaveProperty('muted', true);
  });

  it('автозапуск включён, воспроизведение внутри страницы (playsInline)', () => {
    const { container } = render(
      <VideoTile participant={participant(true, true)} isSelf attachVideo={() => undefined} />,
    );

    expect(videoNode(container)).toHaveProperty('autoplay', true);
    expect(videoNode(container)).toHaveAttribute('playsinline');
  });
});

describe('12.2 подпись и экранирование (ФТ-30, ФТ-39)', () => {
  it('★ HTML в имени остаётся текстом', () => {
    const { container } = render(
      <VideoTile
        participant={participant(true, false, '<img src=x onerror=alert(1)>')}
        isSelf={false}
        attachVideo={() => undefined}
      />,
    );

    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('★ внутренний id участника в DOM не попадает (ФТ-30)', () => {
    const { container } = render(
      <VideoTile
        participant={participant(true, true)}
        isSelf={false}
        attachVideo={() => undefined}
      />,
    );

    expect(container.innerHTML).not.toContain('peer-1');
  });

  it('своя плитка помечена «(вы)»', () => {
    render(
      <VideoTile participant={participant(true, true)} isSelf attachVideo={() => undefined} />,
    );

    expect(screen.getByText(`Борис (${strings.room.you})`)).toBeInTheDocument();
  });
});
