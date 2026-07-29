/**
 * Компонентные тесты экрана входа (задача IP 12.1, ФТ-1, ФТ-38, US-1).
 *
 * Первые тесты проекта в настоящем DOM: до этого разметка проверялась
 * `react-dom/server`, то есть при заданных пропсах. Здесь проверяется то, что
 * без ввода и кликов недоступно вовсе — как форма ведёт себя, пока пользователь
 * печатает.
 *
 * ★ Главный сценарий — дефект ручной приёмки группы 5: при недопустимом имени
 * кнопка `disabled`, поэтому Enter **не порождает** событие `submit`, и без
 * подсказки «на ходу» пользователь оказывается в тупике — кнопка мертва, а
 * почему, интерфейс не говорит.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { JoinScreen } from './JoinScreen';
import { strings } from '../strings';

// Авто-очистка RTL включается только при `globals: true`; здесь — явно.
afterEach(cleanup);

const nameField = () => screen.getByLabelText(strings.join.nameLabel);
const submitButton = () => screen.getByRole('button');

describe('12.1 JoinScreen: исходное состояние', () => {
  it('★ кнопка неактивна, пока имя не введено (ФТ-38)', () => {
    render(<JoinScreen mode="create" onSubmit={() => undefined} />);

    expect(submitButton()).toBeDisabled();
  });

  it('★ пустое поле не ругается: это исходное состояние, а не ошибка', () => {
    render(<JoinScreen mode="create" onSubmit={() => undefined} />);

    expect(screen.getByText(strings.join.nameHint)).toBeTruthy();
    expect(nameField()).toHaveAttribute('aria-invalid', 'false');
  });

  it('подписи различаются для создания и входа (US-1, US-4)', () => {
    render(<JoinScreen mode="create" onSubmit={() => undefined} />);
    expect(submitButton()).toHaveTextContent(strings.join.createButton);

    cleanup();
    render(<JoinScreen mode="join" onSubmit={() => undefined} />);
    expect(submitButton()).toHaveTextContent(strings.join.joinButton);
  });
});

describe('12.1 JoinScreen: ввод имени', () => {
  it('★ кнопка становится активной при допустимом имени', async () => {
    const user = userEvent.setup();
    render(<JoinScreen mode="join" onSubmit={() => undefined} />);

    await user.type(nameField(), 'Аня');

    expect(submitButton()).toBeEnabled();
  });

  it('★ счётчик считает введённые символы (Q7)', async () => {
    const user = userEvent.setup();
    render(<JoinScreen mode="join" onSubmit={() => undefined} />);

    await user.type(nameField(), 'Аня');

    expect(screen.getByText('3 / 30')).toBeTruthy();
  });

  it('★ поле не даёт напечатать больше лимита (ФТ-38)', async () => {
    const user = userEvent.setup();
    render(<JoinScreen mode="join" onSubmit={() => undefined} />);

    await user.type(nameField(), 'я'.repeat(40));

    expect(nameField()).toHaveValue('я'.repeat(30));
    expect(screen.getByText('30 / 30')).toBeTruthy();
  });

  it('★ недопустимые символы: подсказка появляется СРАЗУ, пока пользователь печатает', async () => {
    // Дефект приёмки группы 5: кнопка disabled → Enter не даёт submit →
    // объяснить причину нечем, если подсказку показывать только после отправки.
    const user = userEvent.setup();
    render(<JoinScreen mode="join" onSubmit={() => undefined} />);

    await user.type(nameField(), '<script>');

    expect(screen.getByText(strings.validation.nameInvalidChars)).toBeTruthy();
    expect(submitButton()).toBeDisabled();
    expect(nameField()).toHaveAttribute('aria-invalid', 'true');
  });

  it('★ Enter при недопустимом имени: подсказка на месте, отправки нет', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<JoinScreen mode="join" onSubmit={onSubmit} />);

    await user.type(nameField(), '<script>{Enter}');

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(strings.validation.nameInvalidChars)).toBeTruthy();
  });

  it('★ уход из пустого поля показывает подсказку об обязательности имени', async () => {
    const user = userEvent.setup();
    render(<JoinScreen mode="join" onSubmit={() => undefined} />);

    await user.click(nameField());
    await user.tab();

    expect(screen.getByText(strings.validation.nameRequired)).toBeTruthy();
  });

  it('★ подсказка исчезает, как только имя стало допустимым', async () => {
    const user = userEvent.setup();
    render(<JoinScreen mode="join" onSubmit={() => undefined} />);

    await user.type(nameField(), '<script>');
    expect(screen.getByText(strings.validation.nameInvalidChars)).toBeTruthy();

    await user.clear(nameField());
    await user.type(nameField(), 'Аня');

    expect(screen.queryByText(strings.validation.nameInvalidChars)).toBeNull();
    expect(screen.getByText(strings.join.nameHint)).toBeTruthy();
  });
});

describe('12.1 JoinScreen: отправка', () => {
  it('★ клик по кнопке отдаёт очищенное имя (TDD §10.3)', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<JoinScreen mode="join" onSubmit={onSubmit} />);

    await user.type(nameField(), '  Аня   Петрова  ');
    await user.click(submitButton());

    // Крайние пробелы срезаны, внутренние свёрнуты в один.
    expect(onSubmit).toHaveBeenCalledWith('Аня Петрова');
  });

  it('★ Enter в поле отправляет форму (US-1)', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<JoinScreen mode="join" onSubmit={onSubmit} />);

    await user.type(nameField(), 'Борис{Enter}');

    expect(onSubmit).toHaveBeenCalledWith('Борис');
  });

  it('★ имя из одних пробелов отправить нельзя (ФТ-38)', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<JoinScreen mode="join" onSubmit={onSubmit} />);

    await user.type(nameField(), '   {Enter}');

    expect(onSubmit).not.toHaveBeenCalled();
    expect(submitButton()).toBeDisabled();
  });

  it('★ форма не перезагружает страницу: preventDefault на submit', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<JoinScreen mode="join" onSubmit={onSubmit} />);

    // jsdom печатает ошибку «Not implemented: HTMLFormElement.prototype.requestSubmit»
    // при неотменённой отправке. Ловим её как признак регрессии.
    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => errors.push(args[0]);
    await user.type(nameField(), 'Вера{Enter}');
    console.error = original;

    expect(onSubmit).toHaveBeenCalledOnce();
    expect(errors.filter((e) => String(e).includes('Not implemented'))).toEqual([]);
  });
});
