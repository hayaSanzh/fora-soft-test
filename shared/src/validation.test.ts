/**
 * Обязательные unit-тесты валидации (задача IP 2.4, TDD §11.2).
 *
 * Проверяется не «схема вызывается», а конкретные векторы из требований:
 * пустое имя, пробелы, невидимые символы, превышение длины, инъекция,
 * кириллица с дефисом, пустое сообщение.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_MESSAGE_LEN,
  DEFAULT_MAX_NAME_LEN,
  makeNameSchema,
  makeTextSchema,
  mediaStateSchema,
  nameSchema,
  roomIdSchema,
  sanitizeName,
  textSchema,
  validate,
  type ValidationResult,
} from './index.js';

/** Возвращает очищенное значение либо падает с понятным сообщением. */
function valueOf<T>(result: ValidationResult<T>): T {
  if (!result.ok) throw new Error(`ожидалось успешное значение, получен отказ ${result.error}`);
  return result.value;
}

/** Короткие помощники: тесты должны читаться как перечень требований. */
const name = (input: unknown) => validate(nameSchema, input);
const text = (input: unknown) => validate(textSchema, input);
const roomId = (input: unknown) => validate(roomIdSchema, input);

const ZWSP = '\u200B'; // zero-width space
const ZWJ = '\u200D'; // zero-width joiner
const BOM = '\uFEFF'; // byte order mark

describe('nameSchema: отказы (ФТ-38, US-1)', () => {
  it('пустое имя', () => {
    expect(name('')).toEqual({ ok: false, error: 'INVALID_NAME' });
  });

  it('имя из одних пробелов', () => {
    expect(name('   ')).toEqual({ ok: false, error: 'INVALID_NAME' });
    expect(name('\t \n')).toEqual({ ok: false, error: 'INVALID_NAME' });
  });

  it('имя только из невидимых символов не проходит как «непустое»', () => {
    expect(name(ZWSP + ZWJ + BOM)).toEqual({ ok: false, error: 'INVALID_NAME' });
  });

  it(`длиннее ${DEFAULT_MAX_NAME_LEN} символов`, () => {
    expect(name('я'.repeat(DEFAULT_MAX_NAME_LEN + 1)).ok).toBe(false);
    expect(name('a'.repeat(DEFAULT_MAX_NAME_LEN + 20)).ok).toBe(false);
  });

  it('★ инъекция: HTML и скрипты отсекаются whitelist-ом, а не чёрным списком', () => {
    expect(name('<script>alert(1)</script>').ok).toBe(false);
    expect(name('<img src=x onerror=alert(1)>').ok).toBe(false);
    expect(name('Аня<b>').ok).toBe(false);
    expect(name('"onmouseover="x').ok).toBe(false);
    expect(name("Аня' OR 1=1--").ok).toBe(false);
  });

  it('не начинается с буквы или цифры', () => {
    expect(name('-Аня').ok).toBe(false);
    expect(name('.').ok).toBe(false);
    expect(name('_x').ok).toBe(false);
  });

  it('не-строка на входе', () => {
    expect(name(undefined).ok).toBe(false);
    expect(name(null).ok).toBe(false);
    expect(name(42).ok).toBe(false);
    expect(name({ toString: () => 'Аня' }).ok).toBe(false);
  });

  it('эмодзи не входят в разрешённый набор', () => {
    expect(name('Аня 🎉').ok).toBe(false);
  });
});

describe('nameSchema: допустимые имена', () => {
  it('★ кириллица с дефисом', () => {
    expect(name('Анна-Мария')).toEqual({ ok: true, value: 'Анна-Мария' });
  });

  it('латиница, цифры, точка, подчёркивание, пробел', () => {
    expect(name('John Doe').ok).toBe(true);
    expect(name('user_42').ok).toBe(true);
    expect(name('А.Б. Иванов').ok).toBe(true);
    expect(name('Ürün Çağrı').ok).toBe(true);
    expect(name('用户42').ok).toBe(true);
  });

  it('ровно на границе длины', () => {
    const exact = 'я'.repeat(DEFAULT_MAX_NAME_LEN);
    expect(name(exact)).toEqual({ ok: true, value: exact });
  });

  it('возвращает очищенное значение: пробелы свёрнуты, невидимые вырезаны', () => {
    expect(name('  Аня   Петрова  ')).toEqual({ ok: true, value: 'Аня Петрова' });
    expect(name(`Аня${ZWSP}${ZWJ}`)).toEqual({ ok: true, value: 'Аня' });
    expect(name(`${BOM}Иван`)).toEqual({ ok: true, value: 'Иван' });
  });

  it('санитизация превращает переносы строк в один пробел, а не в склейку', () => {
    expect(sanitizeName('Аня\nПетрова')).toBe('Аня Петрова');
  });

  it('имя, ставшее допустимым после очистки, принимается', () => {
    // 31 символ, из которых один — zero-width: после очистки ровно 30.
    const withInvisible = 'я'.repeat(DEFAULT_MAX_NAME_LEN) + ZWSP;
    expect(name(withInvisible).ok).toBe(true);
  });
});

describe('nameSchema: лимит настраивается (§12.5)', () => {
  it('makeNameSchema уважает переданный лимит', () => {
    const short = makeNameSchema(5);
    expect(validate(short, 'Анна').ok).toBe(true);
    expect(validate(short, 'Анна-Мария').ok).toBe(false);
  });
});

describe('textSchema: отказы (ФТ-24, Q7)', () => {
  it('★ пустое сообщение', () => {
    expect(text('')).toEqual({ ok: false, error: 'EMPTY_TEXT' });
  });

  it('★ сообщение из одних пробелов и переводов строк', () => {
    expect(text('   ')).toEqual({ ok: false, error: 'EMPTY_TEXT' });
    expect(text('\n\n\t ')).toEqual({ ok: false, error: 'EMPTY_TEXT' });
  });

  it('сообщение из одних управляющих символов', () => {
    expect(text('\u0000\u0001\u001F')).toEqual({ ok: false, error: 'EMPTY_TEXT' });
  });

  it(`длиннее ${DEFAULT_MAX_MESSAGE_LEN} символов`, () => {
    expect(text('a'.repeat(DEFAULT_MAX_MESSAGE_LEN + 1))).toEqual({
      ok: false,
      error: 'TEXT_TOO_LONG',
    });
  });

  it('не-строка на входе', () => {
    expect(text(null).ok).toBe(false);
    expect(text(['привет']).ok).toBe(false);
  });
});

describe('textSchema: допустимый текст', () => {
  it('★ HTML сохраняется КАК ЕСТЬ: экранирование только на выходе (TDD §10.3)', () => {
    const xss = '<img src=x onerror=alert(1)>';
    expect(text(xss)).toEqual({ ok: true, value: xss });
    expect(valueOf(text('<script>alert(1)</script>'))).toBe('<script>alert(1)</script>');
  });

  it('ссылки остаются текстом и не преобразуются', () => {
    expect(valueOf(text('javascript:alert(1)'))).toBe('javascript:alert(1)');
    expect(valueOf(text('https://example.com'))).toBe('https://example.com');
  });

  it('переводы строк и табуляция сохраняются, управляющие символы вырезаются', () => {
    expect(valueOf(text('строка1\nстрока2'))).toBe('строка1\nстрока2');
    expect(valueOf(text('\u0434\u043E\u0007\u043F\u043E\u0441\u043B\u0435'))).toBe(
      '\u0434\u043E\u043F\u043E\u0441\u043B\u0435',
    );
  });

  it('обрезает пробелы по краям', () => {
    expect(text('  привет  ')).toEqual({ ok: true, value: 'привет' });
  });

  it('ровно на границе длины', () => {
    const exact = 'a'.repeat(DEFAULT_MAX_MESSAGE_LEN);
    expect(text(exact)).toEqual({ ok: true, value: exact });
  });

  it('эмодзи в сообщении допустимы — ограничение только на имя', () => {
    expect(text('Привет 🎉').ok).toBe(true);
  });

  it('makeTextSchema уважает переданный лимит', () => {
    expect(validate(makeTextSchema(3), 'абвг')).toEqual({ ok: false, error: 'TEXT_TOO_LONG' });
  });
});

describe('roomIdSchema (TDD §5.3)', () => {
  it('принимает nanoid-подобные значения', () => {
    expect(roomId('V1StGXR8_Z5j')).toEqual({ ok: true, value: 'V1StGXR8_Z5j' });
    expect(roomId('abcd').ok).toBe(true);
    expect(roomId('A-b_9').ok).toBe(true);
    expect(roomId('x'.repeat(64)).ok).toBe(true);
  });

  it('отклоняет слишком короткие и слишком длинные', () => {
    expect(roomId('abc')).toEqual({ ok: false, error: 'INVALID_ROOM_ID' });
    expect(roomId('x'.repeat(65)).ok).toBe(false);
  });

  it('★ отклоняет path-подобные и мусорные значения — иначе они станут ключами Map', () => {
    expect(roomId('../../etc/passwd').ok).toBe(false);
    expect(roomId('room/1').ok).toBe(false);
    expect(roomId('комната').ok).toBe(false);
    expect(roomId('room 1').ok).toBe(false);
    expect(roomId('<script>').ok).toBe(false);
    expect(roomId('__proto__').ok).toBe(true); // допустимо по формату; Map не прототипирует ключи
  });

  it('не-строка на входе', () => {
    expect(roomId(undefined).ok).toBe(false);
    expect(roomId(12345).ok).toBe(false);
  });
});

describe('mediaStateSchema', () => {
  it('принимает корректное состояние устройств', () => {
    expect(validate(mediaStateSchema, { audio: true, video: false })).toEqual({
      ok: true,
      value: { audio: true, video: false },
    });
  });

  it('отклоняет неполное и нестрогое состояние', () => {
    expect(validate(mediaStateSchema, { audio: true }).ok).toBe(false);
    expect(validate(mediaStateSchema, { audio: 'yes', video: 1 }).ok).toBe(false);
    expect(validate(mediaStateSchema, null).ok).toBe(false);
  });
});
