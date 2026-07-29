/**
 * Компонентные тесты экранов ошибок в связке с машиной состояний
 * (задача IP 12.4, ФТ-8, ФТ-33, ФТ-35, TDD §3.3, §8.3).
 *
 * До этой группы кнопки экранов проверялись двумя способами: наличием в разметке
 * и вызовом `onClick`, вытащенного из дерева элементов. Ни один из них не
 * отвечает на главный вопрос — **двигает ли кнопка машину состояний**. Здесь
 * экраны подключены к настоящему `roomReducer`, и клик проверяется как клик.
 *
 * Стенд намеренно повторяет только связку «состояние → экран → действие», без
 * сессии: `RoomPage` при входе в `acquiringMedia` поднимает медиа и сокет, а это
 * область E2E-тестов (группа 13), не компонентных.
 */
import { useReducer } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LeftScreen } from './LeftScreen';
import { MediaErrorBanner } from './MediaErrorBanner';
import { RoomFullScreen } from './RoomFullScreen';
import { ServerErrorScreen } from './ServerErrorScreen';
import { UnmuteAudioGate } from './UnmuteAudioGate';
import { initialRoomState, roomReducer, type RoomState } from '../../state/roomReducer';
import { strings } from '../../strings';

afterEach(cleanup);

/** Состояние «участник уже входил в комнату»: имя и комната известны. */
function stateWith(patch: Partial<RoomState>): RoomState {
  return { ...initialRoomState, roomId: 'RoomAAAAAAAA', selfName: 'Аня', ...patch };
}

/** Стенд: состояние → экран → действие → новое состояние. */
function Harness({ initial }: { initial: RoomState }) {
  const [state, dispatch] = useReducer(roomReducer, initial);

  return (
    <>
      <span data-testid="screen">{state.screen}</span>
      <span data-testid="media-error">{state.mediaError ?? 'нет'}</span>
      <span data-testid="name">{state.selfName || 'нет'}</span>

      {state.screen === 'roomFull' && (
        <RoomFullScreen onRetry={() => dispatch({ type: 'RETRY_JOIN' })} />
      )}
      {state.screen === 'serverError' && (
        <ServerErrorScreen onRetry={() => dispatch({ type: 'RETRY_JOIN' })} />
      )}
      {state.screen === 'left' && <LeftScreen onBack={() => dispatch({ type: 'BACK_TO_IDLE' })} />}

      {state.mediaError && (
        <MediaErrorBanner
          kind={state.mediaError}
          onDismiss={() => dispatch({ type: 'MEDIA_ERROR_DISMISSED' })}
        />
      )}

      <button
        type="button"
        onClick={() => dispatch({ type: 'MEDIA_FAILED', kind: 'NotAllowedError' })}
      >
        стенд: отказ камеры
      </button>
    </>
  );
}

const screenName = () => screen.getByTestId('screen').textContent;

describe('12.4 «Комната заполнена» → повтор входа (ФТ-8, US-5)', () => {
  it('★ клик по «Повторить вход» возвращает машину к запросу устройств', async () => {
    const user = userEvent.setup();
    render(<Harness initial={stateWith({ screen: 'roomFull' })} />);

    expect(screen.getByText(strings.errors.roomFullTitle)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: strings.errors.roomFullRetry }));

    expect(screenName()).toBe('acquiringMedia');
  });

  it('★ имя не спрашивается заново: оно сохранено (ФТ-28 не нарушен)', async () => {
    const user = userEvent.setup();
    render(<Harness initial={stateWith({ screen: 'roomFull' })} />);

    await user.click(screen.getByRole('button', { name: strings.errors.roomFullRetry }));

    expect(screen.getByTestId('name')).toHaveTextContent('Аня');
  });

  it('★ повтор без известного имени ведёт на ввод имени, а не в тупик', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ ...initialRoomState, screen: 'roomFull' }} />);

    await user.click(screen.getByRole('button', { name: strings.errors.roomFullRetry }));

    expect(screenName()).toBe('idle');
  });
});

describe('12.4 «Нет связи с сервером» → повтор (ФТ-35, US-13)', () => {
  it('★ клик по «Повторить» возвращает машину к запросу устройств', async () => {
    const user = userEvent.setup();
    render(<Harness initial={stateWith({ screen: 'serverError' })} />);

    await user.click(screen.getByRole('button', { name: strings.errors.serverErrorRetry }));

    expect(screenName()).toBe('acquiringMedia');
  });
});

describe('12.4 «Вы вышли из комнаты» → возврат (ФТ-27, ФТ-28)', () => {
  it('★ возврат ведёт на ввод имени', async () => {
    const user = userEvent.setup();
    render(<Harness initial={stateWith({ screen: 'left' })} />);

    await user.click(screen.getByRole('button', { name: strings.errors.leftBack }));

    expect(screenName()).toBe('idle');
  });
});

describe('12.4 ★ ошибка медиа не терминальна (ФТ-33, US-12, TDD §8.3)', () => {
  it('★ отказ камеры при запросе устройств ведёт в connecting, а не на экран ошибки', async () => {
    const user = userEvent.setup();
    render(<Harness initial={stateWith({ screen: 'acquiringMedia' })} />);

    await user.click(screen.getByRole('button', { name: 'стенд: отказ камеры' }));

    // ★ Вход продолжается: пользователь попадёт в комнату без устройств.
    expect(screenName()).toBe('connecting');
    expect(screen.getByText(strings.errors.mediaNotAllowed)).toBeInTheDocument();
  });

  it('★ отказ камеры внутри комнаты не выкидывает из неё', async () => {
    const user = userEvent.setup();
    render(<Harness initial={stateWith({ screen: 'inRoom' })} />);

    await user.click(screen.getByRole('button', { name: 'стенд: отказ камеры' }));

    expect(screenName()).toBe('inRoom');
    expect(screen.getByText(strings.errors.mediaNotAllowed)).toBeInTheDocument();
  });

  it('★ «Скрыть» убирает баннер и не меняет экран', async () => {
    const user = userEvent.setup();
    render(<Harness initial={stateWith({ screen: 'inRoom', mediaError: 'NotReadableError' })} />);

    expect(screen.getByText(strings.errors.mediaNotReadable)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: strings.errors.dismiss }));

    expect(screen.queryByText(strings.errors.mediaNotReadable)).toBeNull();
    expect(screen.getByTestId('media-error')).toHaveTextContent('нет');
    expect(screenName()).toBe('inRoom');
  });

  it('★ скрытый баннер сам не возвращается', async () => {
    const user = userEvent.setup();
    render(<Harness initial={stateWith({ screen: 'inRoom', mediaError: 'DeviceLost' })} />);

    await user.click(screen.getByRole('button', { name: strings.errors.dismiss }));

    // Ре-рендеры не должны воскрешать сообщение: оно снимается состоянием.
    expect(screen.queryByRole('button', { name: strings.errors.dismiss })).toBeNull();
  });
});

describe('12.4 оверлей «Включить звук» (ФТ-37)', () => {
  it('★ клик вызывает включение звука', async () => {
    const user = userEvent.setup();
    let enabled = 0;
    render(<UnmuteAudioGate onEnable={() => (enabled += 1)} />);

    await user.click(screen.getByRole('button', { name: strings.errors.audioBlockedButton }));

    expect(enabled).toBe(1);
  });

  it('★ оверлей объявляется как срочное сообщение (role=alert)', () => {
    render(<UnmuteAudioGate onEnable={() => undefined} />);

    expect(screen.getByRole('alert')).toHaveTextContent(strings.errors.audioBlockedText);
  });
});
