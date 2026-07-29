/**
 * Тесты экранов ошибок и оверлеев (задачи IP 11.1–11.6).
 *
 * Разметка проверяется `react-dom/server`, а **привязка обработчиков** — обходом
 * дерева элементов: компонент вызывается как обычная функция, и в возвращённом
 * дереве ищется `onClick`. Это позволяет проверить «кнопка действительно
 * вызывает обработчик» без jsdom, который придёт в группе 12. План требует у
 * экранов именно **рабочие** кнопки, а не нарисованные.
 */
import { isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { InvalidLinkScreen } from './InvalidLinkScreen';
import { LeftScreen } from './LeftScreen';
import { MediaErrorBanner, mediaErrorText } from './MediaErrorBanner';
import { RoomFullScreen } from './RoomFullScreen';
import { ServerErrorScreen } from './ServerErrorScreen';
import { StatusScreen } from './StatusScreen';
import { UnmuteAudioGate } from './UnmuteAudioGate';
import { UnsupportedScreen } from './UnsupportedScreen';
import { VideoTile } from '../VideoTile';
import { strings } from '../../strings';
import type { MediaErrorKind } from '../../state/roomReducer';

/**
 * `renderToStaticMarkup` — серверный рендер, а react-router внутри использует
 * `useLayoutEffect`; предупреждение об этом для наших проверок шум. Глушится
 * только оно, остальные ошибки консоли по-прежнему видны (как в `render.test.tsx`).
 */
const originalError = console.error;
beforeAll(() => {
  console.error = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].includes('useLayoutEffect does nothing')) return;
    originalError(...(args as Parameters<typeof console.error>));
  };
});
afterAll(() => {
  console.error = originalError;
});

/** Все `onClick` из дерева элементов — компонент рендерить для этого не нужно. */
function clickHandlers(node: ReactNode): Array<() => void> {
  if (Array.isArray(node)) return node.flatMap((child) => clickHandlers(child as ReactNode));
  if (!isValidElement(node)) return [];
  const props = node.props as { onClick?: unknown; children?: ReactNode };
  const own = typeof props.onClick === 'function' ? [props.onClick as () => void] : [];
  return [...own, ...clickHandlers(props.children)];
}

describe('11.1 RoomFullScreen (ФТ-8, US-5)', () => {
  it('★ объясняет причину и предлагает повторить вход', () => {
    const html = renderToStaticMarkup(<RoomFullScreen onRetry={() => undefined} />);

    expect(html).toContain(strings.errors.roomFullTitle);
    expect(html).toContain(strings.errors.roomFullText);
    expect(html).toContain(strings.errors.roomFullRetry);
  });

  it('★ кнопка рабочая: клик вызывает onRetry (а не «нарисована»)', () => {
    const onRetry = vi.fn();
    const handlers = clickHandlers(RoomFullScreen({ onRetry }));

    expect(handlers).toHaveLength(1);
    handlers[0]?.();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('11.2 ServerErrorScreen (ФТ-35, US-13)', () => {
  it('★ единый текст для «сервер недоступен» и «соединение прервалось»', () => {
    const html = renderToStaticMarkup(<ServerErrorScreen onRetry={() => undefined} />);

    expect(html).toContain(strings.errors.serverErrorTitle);
    expect(html).toContain(strings.errors.serverErrorRetry);
  });

  it('★ формулировка «соединение потеряно» не используется (ФТ-31)', () => {
    // ФТ-31 запрещает этот оборот применительно к участникам; чтобы он не
    // расползался по интерфейсу, его нет и в тексте про сервер.
    const html = renderToStaticMarkup(<ServerErrorScreen onRetry={() => undefined} />);

    expect(html.toLowerCase()).not.toContain('соединение потеряно');
  });

  it('★ кнопка «Повторить» вызывает обработчик', () => {
    const onRetry = vi.fn();
    clickHandlers(ServerErrorScreen({ onRetry }))[0]?.();

    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('11.3 UnsupportedScreen (ФТ-36, US-13)', () => {
  it('★ разные тексты для старого браузера и для страницы без HTTPS', () => {
    const old = renderToStaticMarkup(<UnsupportedScreen kind="WEBRTC_UNSUPPORTED" />);
    const insecure = renderToStaticMarkup(<UnsupportedScreen kind="INSECURE_CONTEXT" />);

    expect(old).toContain(strings.errors.unsupportedText);
    expect(old).not.toContain(strings.errors.insecureContextText);
    expect(insecure).toContain(strings.errors.insecureContextText);
    expect(insecure).not.toContain(strings.errors.unsupportedText);
  });

  it('★ кнопки действия нет: выйти из состояния внутри приложения нельзя', () => {
    const html = renderToStaticMarkup(<UnsupportedScreen kind="WEBRTC_UNSUPPORTED" />);

    expect(html).not.toContain('<button');
    expect(clickHandlers(UnsupportedScreen({ kind: 'WEBRTC_UNSUPPORTED' }))).toHaveLength(0);
  });

  it('★ не зависит от роутера: рендерится вне контекста (main.tsx до App)', () => {
    // Если бы внутри оказался <Link>, рендер вне <BrowserRouter> упал бы.
    expect(() =>
      renderToStaticMarkup(<UnsupportedScreen kind="WEBRTC_UNSUPPORTED" />),
    ).not.toThrow();
  });
});

describe('11.4 MediaErrorBanner (ФТ-33, US-12)', () => {
  const kinds: MediaErrorKind[] = [
    'NotAllowedError',
    'NotFoundError',
    'NotReadableError',
    'OverconstrainedError',
    'DeviceLost',
    'Unknown',
  ];

  it('★ у каждого кода из §8.1 свой непустой текст — не «что-то пошло не так»', () => {
    const texts = kinds.map((kind) => mediaErrorText(kind));

    for (const text of texts) expect(text.length).toBeGreaterThan(10);
    expect(new Set(texts).size).toBe(kinds.length);
  });

  it('★ баннер сообщает, что пользователь остаётся в комнате (ФТ-33)', () => {
    const html = renderToStaticMarkup(
      <MediaErrorBanner kind="NotAllowedError" onDismiss={() => undefined} />,
    );

    expect(html).toContain('Вы в комнате');
  });

  it('★ баннер закрывается, и кнопка закрытия рабочая', () => {
    const onDismiss = vi.fn();
    clickHandlers(MediaErrorBanner({ kind: 'DeviceLost', onDismiss }))[0]?.();

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('★ это баннер, а не экран: разметка не подменяет собой страницу', () => {
    const html = renderToStaticMarkup(
      <MediaErrorBanner kind="NotFoundError" onDismiss={() => undefined} />,
    );

    expect(html).not.toContain('<main');
    expect(html).toContain('role="status"');
  });

  /**
   * ★ Дефект ручной приёмки группы 13: заблокирована была только камера,
   * микрофон работал — а баннер утверждал «вас не видно и не слышно».
   * Сообщение, преувеличивающее проблему, заставляет чинить не то.
   */
  describe('★ частичный отказ: текст не преувеличивает проблему', () => {
    it('★ работает только микрофон — речь о камере, и «слышно» подтверждается', () => {
      const text = mediaErrorText('NotAllowedError', { audio: true, video: false });

      expect(text).toContain('Нет доступа к камере.');
      expect(text).toContain('вас слышно');
      expect(text).not.toContain('не слышно');
    });

    it('★ работает только камера — речь о микрофоне, и «видно» подтверждается', () => {
      const text = mediaErrorText('NotAllowedError', { audio: false, video: true });

      expect(text).toContain('Нет доступа к микрофону.');
      expect(text).toContain('вас видно');
      expect(text).not.toContain('не видно');
    });

    it('★ не работает ничего — общий текст про оба устройства', () => {
      const text = mediaErrorText('NotAllowedError', { audio: false, video: false });

      expect(text).toBe(strings.errors.mediaNotAllowed);
      expect(text).toContain('не видно и не слышно');
    });

    it('★ состояние неизвестно (экран ожидания) — общий текст', () => {
      expect(mediaErrorText('NotAllowedError')).toBe(strings.errors.mediaNotAllowed);
    });

    it('то же уточнение для отсутствующего устройства (NotFoundError)', () => {
      expect(mediaErrorText('NotFoundError', { audio: true, video: false })).toBe(
        strings.errors.mediaNotFoundCamera,
      );
      expect(mediaErrorText('NotFoundError', { audio: false, video: true })).toBe(
        strings.errors.mediaNotFoundMic,
      );
      expect(mediaErrorText('NotFoundError', { audio: false, video: false })).toBe(
        strings.errors.mediaNotFound,
      );
    });

    it('коды, не зависящие от устройства, состоянием не уточняются', () => {
      for (const kind of [
        'NotReadableError',
        'OverconstrainedError',
        'DeviceLost',
        'Unknown',
      ] as const) {
        expect(mediaErrorText(kind, { audio: true, video: false })).toBe(mediaErrorText(kind));
      }
    });

    it('★ баннер в комнате получает фактическое состояние устройств', () => {
      const html = renderToStaticMarkup(
        <MediaErrorBanner
          kind="NotAllowedError"
          media={{ audio: true, video: false }}
          onDismiss={() => undefined}
        />,
      );

      expect(html).toContain('вас слышно, но не видно');
    });
  });
});

describe('11.5 UnmuteAudioGate (ФТ-37)', () => {
  it('★ объясняет, что дело в браузере, и предлагает включить звук', () => {
    const html = renderToStaticMarkup(<UnmuteAudioGate onEnable={() => undefined} />);

    expect(html).toContain(strings.errors.audioBlockedText);
    expect(html).toContain(strings.errors.audioBlockedButton);
    // Пользователь должен понять, что собеседник не молчит.
    expect(html).toContain('Браузер заблокировал');
  });

  it('★ клик вызывает обработчик — он и есть жест пользователя', () => {
    const onEnable = vi.fn();
    clickHandlers(UnmuteAudioGate({ onEnable }))[0]?.();

    expect(onEnable).toHaveBeenCalledTimes(1);
  });

  it('оверлей, а не подсказка: накрывает сетку', () => {
    const html = renderToStaticMarkup(<UnmuteAudioGate onEnable={() => undefined} />);

    expect(html).toContain('class="gate"');
    expect(html).toContain('role="alert"');
  });
});

describe('11.6 индикация соединения на плитке (ФТ-34, Q9, риск R1)', () => {
  const participant = {
    id: 'peer-1',
    name: 'Борис',
    media: { audio: true, video: true },
    joinedAt: 1_769_000_000_000,
  };
  const render = (state: RTCPeerConnectionState | undefined, isSelf = false) =>
    renderToStaticMarkup(
      <VideoTile
        participant={participant}
        isSelf={isSelf}
        connectionState={state}
        attachVideo={() => undefined}
      />,
    );

  it('★ failed — отдельный текст и отдельный класс: без TURN пара не соединится', () => {
    const html = render('failed');

    expect(html).toContain(strings.errors.peerFailed);
    expect(html).toContain('tile__status--failed');
  });

  it('★ состояние ещё неизвестно — «Соединение…», а не тишина', () => {
    // Состояние приходит из onconnectionstatechange; до первого события его нет,
    // и плитка иначе была бы чёрной без объяснений.
    const html = render(undefined);

    expect(html).toContain(strings.errors.peerConnecting);
    expect(html).not.toContain('tile__status--failed');
  });

  it('★ connected — плашки нет', () => {
    const html = render('connected');

    expect(html).not.toContain('tile__status');
  });

  it('★ у себя плашки нет никогда: своё видео локальное', () => {
    expect(render('failed', true)).not.toContain('tile__status');
    expect(render(undefined, true)).not.toContain('tile__status');
  });

  it('closed показывается как отсутствие связи, disconnected — как соединение', () => {
    expect(render('closed')).toContain(strings.errors.peerFailed);
    expect(render('disconnected')).toContain(strings.errors.peerConnecting);
  });

  it('★ плашка не заменяет <video>: элемент остаётся в DOM (риск R5)', () => {
    expect(render('failed')).toContain('<video');
  });
});

describe('11 экраны ожидания и битой ссылки', () => {
  const statusProps = {
    roomId: 'RoomAAAAAAAA',
    name: 'Аня',
    mediaError: null,
    media: { audio: true, video: true },
    onDismissMediaError: () => undefined,
    onCancel: () => undefined,
  };

  it('★ фаза запроса устройств и фаза подключения различаются текстом', () => {
    const acquiring = renderToStaticMarkup(
      <StatusScreen {...statusProps} phase="acquiringMedia" />,
    );
    const connecting = renderToStaticMarkup(<StatusScreen {...statusProps} phase="connecting" />);

    expect(acquiring).toContain(strings.room.acquiringMedia);
    expect(connecting).toContain(strings.room.connecting);
  });

  it('★ ошибка устройств видна уже на экране ожидания (ФТ-33)', () => {
    const html = renderToStaticMarkup(
      <StatusScreen {...statusProps} phase="connecting" mediaError="NotAllowedError" />,
    );

    expect(html).toContain(strings.errors.mediaNotAllowed);
  });

  it('★ экран ожидания не тупик: есть возврат', () => {
    const onCancel = vi.fn();
    clickHandlers(StatusScreen({ ...statusProps, phase: 'connecting', onCancel }))[0]?.();

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('★ битая ссылка ведёт на создание комнаты (TDD §5.3)', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <InvalidLinkScreen />
      </MemoryRouter>,
    );

    expect(html).toContain(strings.errors.invalidLinkTitle);
    expect(html).toContain('href="/"');
  });

  it('★ экран после выхода не тупик: возврат вызывает обработчик (ФТ-27)', () => {
    const onBack = vi.fn();
    clickHandlers(LeftScreen({ onBack }))[0]?.();

    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
