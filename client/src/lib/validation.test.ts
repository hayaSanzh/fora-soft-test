/**
 * Тесты клиентской валидации (задача IP 5.4, ФТ-38, US-1).
 *
 * Главное свойство — зеркальность серверной: правила берутся из общих схем,
 * а не переписываются заново. Здесь проверяется, что клиент отклоняет ровно то
 * же, что и сервер, и что подсказки различимы для пользователя.
 */
import { describe, expect, it } from 'vitest';
import { makeNameSchema, validate } from '@video-chat/shared';
import { config } from '../config';
import { checkMessage, checkName, nameLength } from './validation';

describe('checkName: отказы с внятной подсказкой', () => {
  it('пустое имя и пробелы — подсказка про обязательность', () => {
    expect(checkName('')).toMatchObject({ ok: false, value: '' });
    expect(checkName('   ').hint).toContain('Введите имя');
    expect(checkName('\u200B\u200D').hint).toContain('Введите имя');
  });

  it('слишком длинное имя — подсказка про длину, а не про символы', () => {
    const result = checkName('я'.repeat(config.maxNameLen + 1));

    expect(result.ok).toBe(false);
    expect(result.hint).toContain('не длиннее');
  });

  it('★ недопустимые символы — подсказка про набор символов', () => {
    const result = checkName('<script>alert(1)</script>');

    expect(result.ok).toBe(false);
    expect(result.hint).toContain('буквы, цифры');
  });

  it('имя, не начинающееся с буквы или цифры, отклоняется', () => {
    expect(checkName('-Аня').ok).toBe(false);
    expect(checkName('_x').ok).toBe(false);
  });
});

describe('checkName: успех и очистка', () => {
  it('★ кириллица с дефисом принимается', () => {
    expect(checkName('Анна-Мария')).toEqual({ ok: true, value: 'Анна-Мария', hint: null });
  });

  it('возвращает очищенное значение — именно оно уходит на сервер', () => {
    expect(checkName('  Анна\u200B   Мария  ').value).toBe('Анна Мария');
  });

  it('имя на границе длины принимается', () => {
    const exact = 'я'.repeat(config.maxNameLen);
    expect(checkName(exact).ok).toBe(true);
  });
});

describe('★ зеркальность серверной валидации', () => {
  const serverSchema = makeNameSchema(config.maxNameLen);
  const cases = [
    '',
    '   ',
    'Аня',
    'Анна-Мария',
    'John Doe',
    'user_42',
    'А.Б. Иванов',
    '<script>',
    'Аня<b>',
    'Аня 🎉',
    '-Аня',
    '.',
    'я'.repeat(30),
    'я'.repeat(31),
    '\u200BАня\u200D',
    'Аня\nПетрова',
  ];

  it.each(cases)('клиент и сервер согласны про «%s»', (input) => {
    const client = checkName(input);
    const server = validate(serverSchema, input);

    expect(client.ok).toBe(server.ok);
    if (client.ok && server.ok) expect(client.value).toBe(server.value);
  });
});

describe('checkMessage (ФТ-24, Q7)', () => {
  it('пустое сообщение и пробелы отклоняются', () => {
    expect(checkMessage('').ok).toBe(false);
    expect(checkMessage('   ').hint).toContain('пустым');
  });

  it('превышение длины даёт свою подсказку', () => {
    const result = checkMessage('x'.repeat(config.maxMessageLen + 1));

    expect(result.ok).toBe(false);
    expect(result.hint).toContain('слишком длинное');
  });

  it('★ HTML в сообщении допустим и не изменяется — экранирование при рендере', () => {
    const xss = '<img src=x onerror=alert(1)>';

    expect(checkMessage(xss)).toEqual({ ok: true, value: xss, hint: null });
  });

  it('переводы строк сохраняются', () => {
    expect(checkMessage('строка1\nстрока2').value).toBe('строка1\nстрока2');
  });
});

describe('nameLength (счётчик в UI)', () => {
  it('считает по очищенному значению, а не по сырому вводу', () => {
    expect(nameLength('  Аня  ')).toBe(3);
    expect(nameLength('Аня\u200B')).toBe(3);
    expect(nameLength('Аня   Петрова')).toBe('Аня Петрова'.length);
  });
});
