/**
 * Обязательные unit-тесты `RoomStore` (задача IP 3.5, TDD §7.2, §11.2).
 *
 * Ключевой тест здесь — про атомарность лимита (ФТ-7 / F-05): он проверяет не
 * «функция возвращает ROOM_FULL», а что 10 одновременных входов в одном тике
 * event loop впускают ровно 4 участника.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_MESSAGES,
  DEFAULT_MAX_PARTICIPANTS,
  type MediaState,
} from '@video-chat/shared';
import { RoomStore } from './RoomStore.js';

const ON: MediaState = { audio: true, video: true };
const OFF: MediaState = { audio: false, video: false };

/** Детерминированный стор: предсказуемые id и время в утверждениях. */
function makeStore(overrides: Partial<{ maxParticipants: number; maxMessages: number }> = {}) {
  let tick = 0;
  let seq = 0;
  return new RoomStore({
    ...overrides,
    now: () => 1_769_000_000_000 + tick++,
    generateId: () => `m${++seq}`,
  });
}

describe('createIfAbsent / get (ФТ-5, ФТ-6)', () => {
  it('неизвестный roomId создаёт комнату — состояния «не найдено» не существует', () => {
    const store = makeStore();

    expect(store.get('V1StGXR8_Z5j')).toBeUndefined();
    const room = store.createIfAbsent('V1StGXR8_Z5j');

    expect(room.id).toBe('V1StGXR8_Z5j');
    expect(room.participants.size).toBe(0);
    expect(store.get('V1StGXR8_Z5j')).toBe(room);
  });

  it('повторный вызов возвращает ту же комнату, а не создаёт новую', () => {
    const store = makeStore();
    const first = store.createIfAbsent('room-1');
    first.messages.push({ type: 'system', id: 'x', kind: 'join', name: 'Аня', ts: 1 });

    const second = store.createIfAbsent('room-1');

    expect(second).toBe(first);
    expect(second.messages).toHaveLength(1);
    expect(store.stats().rooms).toBe(1);
  });

  it('вход по «чужому» угаданному id — штатное поведение (ФТ-6)', () => {
    const store = makeStore();
    store.join('secret-room', 's1', 'Хозяин', ON);

    const guest = store.join('secret-room', 's2', 'Гость', ON);

    expect(guest.ok).toBe(true);
    expect(store.get('secret-room')?.participants.size).toBe(2);
  });
});

describe('join: лимит участников (ФТ-7, ФТ-8, US-5)', () => {
  it('впускает ровно maxParticipants, пятому отвечает ROOM_FULL', () => {
    const store = makeStore();

    for (let i = 1; i <= DEFAULT_MAX_PARTICIPANTS; i++) {
      expect(store.join('r', `s${i}`, `Участник ${i}`, ON).ok).toBe(true);
    }
    const fifth = store.join('r', 's5', 'Пятый', ON);

    expect(fifth).toEqual({ ok: false, error: 'ROOM_FULL' });
    expect(store.get('r')?.participants.size).toBe(DEFAULT_MAX_PARTICIPANTS);
  });

  it('★ 10 синхронных join в одном тике впускают ровно 4 (атомарность F-05)', () => {
    const store = makeStore();

    // Ни одного await между вызовами: ровно та ситуация, которую создаёт
    // event loop при одновременных room:join от разных сокетов.
    const results = Array.from({ length: 10 }, (_, i) =>
      store.join('race', `socket-${i}`, `Участник ${i}`, ON),
    );

    const admitted = results.filter((r) => r.ok);
    const rejected = results.filter((r) => !r.ok);

    expect(admitted).toHaveLength(DEFAULT_MAX_PARTICIPANTS);
    expect(rejected).toHaveLength(10 - DEFAULT_MAX_PARTICIPANTS);
    expect(rejected.every((r) => !r.ok && r.error === 'ROOM_FULL')).toBe(true);
    expect(store.get('race')?.participants.size).toBe(DEFAULT_MAX_PARTICIPANTS);
  });

  it('★ гонка за последний слот: при 3 занятых слотах из двух входов проходит один', () => {
    const store = makeStore();
    for (let i = 1; i <= 3; i++) store.join('r', `s${i}`, `У${i}`, ON);

    const a = store.join('r', 'race-a', 'A', ON);
    const b = store.join('r', 'race-b', 'B', ON);

    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(store.get('r')?.participants.size).toBe(4);
  });

  it('★ страж: в теле join() нет await — иначе проверка лимита перестаёт быть атомарной', () => {
    const source = readFileSync(path.join(import.meta.dirname, 'RoomStore.ts'), 'utf8');
    const body = source.slice(
      source.indexOf('  join(roomId: string'),
      source.indexOf('  leave(roomId: string'),
    );

    expect(body.length).toBeGreaterThan(100); // тело действительно найдено
    expect(body).not.toMatch(/\bawait\b/);
    expect(body).not.toMatch(/\.then\(|nextTick|setTimeout|setImmediate/);
    expect(RoomStore.prototype.join.constructor.name).toBe('Function'); // не AsyncFunction
  });

  it('освободившийся слот снова доступен', () => {
    const store = makeStore();
    for (let i = 1; i <= 4; i++) store.join('r', `s${i}`, `У${i}`, ON);
    expect(store.join('r', 's5', 'Пятый', ON).ok).toBe(false);

    store.leave('r', 's2');

    expect(store.join('r', 's5', 'Пятый', ON).ok).toBe(true);
    expect(store.get('r')?.participants.size).toBe(4);
  });

  it('один сокет не может занять два слота', () => {
    const store = makeStore();
    store.join('r', 's1', 'Аня', ON);

    expect(store.join('r', 's1', 'Аня (снова)', ON)).toEqual({
      ok: false,
      error: 'ALREADY_JOINED',
    });
    expect(store.get('r')?.participants.size).toBe(1);
  });

  it('лимит настраивается (feature-flag §12.5), при 0 пустышка не остаётся в памяти', () => {
    expect(makeStore({ maxParticipants: 2 }).join('r', 's1', 'A', ON).ok).toBe(true);

    const two = makeStore({ maxParticipants: 2 });
    two.join('r', 's1', 'A', ON);
    two.join('r', 's2', 'B', ON);
    expect(two.join('r', 's3', 'C', ON)).toEqual({ ok: false, error: 'ROOM_FULL' });

    const zero = makeStore({ maxParticipants: 0 });
    expect(zero.join('r', 's1', 'A', ON)).toEqual({ ok: false, error: 'ROOM_FULL' });
    expect(zero.stats().rooms).toBe(0);
  });

  it('участник сохраняется целиком: имя, состояние устройств, время входа', () => {
    const store = makeStore();
    const result = store.join('r', 's1', 'Анна-Мария', OFF);

    expect(result.ok && result.self).toMatchObject({
      id: 's1',
      name: 'Анна-Мария',
      media: OFF,
    });
    expect(result.ok && result.self.joinedAt).toBeGreaterThan(0);
  });
});

describe('leave: жизненный цикл комнаты (ФТ-9, ФТ-27, US-10)', () => {
  it('★ выход последнего участника уничтожает комнату вместе с историей', () => {
    const store = makeStore();
    store.join('r', 's1', 'Аня', ON);
    store.addUserMessage('r', store.getParticipant('r', 's1')!, 'секрет');
    expect(store.get('r')?.messages).toHaveLength(1);

    const left = store.leave('r', 's1');

    expect(left?.name).toBe('Аня');
    expect(store.get('r')).toBeUndefined();
    expect(store.stats()).toEqual({ rooms: 0, participants: 0 });
  });

  it('★ повторный вход по тому же id даёт пустую комнату без старой переписки', () => {
    const store = makeStore();
    store.join('r', 's1', 'Аня', ON);
    store.addUserMessage('r', store.getParticipant('r', 's1')!, 'старое сообщение');
    store.leave('r', 's1');

    store.join('r', 's2', 'Борис', ON);

    expect(store.get('r')?.messages).toEqual([]);
    expect(store.get('r')?.participants.size).toBe(1);
    expect(store.snapshot('r')?.messages).toEqual([]);
  });

  it('пока остаётся хотя бы один участник, комната и история живут', () => {
    const store = makeStore();
    store.join('r', 's1', 'Аня', ON);
    store.join('r', 's2', 'Борис', ON);
    store.addUserMessage('r', store.getParticipant('r', 's1')!, 'привет');

    store.leave('r', 's1');

    expect(store.get('r')).toBeDefined();
    expect(store.get('r')?.messages).toHaveLength(1);
    expect(store.get('r')?.participants.size).toBe(1);
  });

  it('идемпотентен: повторный выход и выход из несуществующей комнаты безопасны', () => {
    const store = makeStore();
    store.join('r', 's1', 'Аня', ON);

    expect(store.leave('r', 's1')?.id).toBe('s1');
    expect(store.leave('r', 's1')).toBeNull();
    expect(store.leave('нет-такой', 's1')).toBeNull();
  });

  it('выход неизвестного сокета не удаляет комнату у остальных', () => {
    const store = makeStore();
    store.join('r', 's1', 'Аня', ON);

    expect(store.leave('r', 'чужой-сокет')).toBeNull();
    expect(store.get('r')?.participants.size).toBe(1);
  });
});

describe('addMessage: история и ring buffer (ФТ-21…23, ФТ-25)', () => {
  it('проставляет серверные id и ts, сохраняя текст как есть', () => {
    const store = makeStore();
    store.join('r', 's1', 'Аня', ON);
    const author = store.getParticipant('r', 's1')!;

    const xss = '<img src=x onerror=alert(1)>';
    const item = store.addUserMessage('r', author, xss);

    expect(item).toMatchObject({
      type: 'user',
      id: 'm1',
      authorId: 's1',
      authorName: 'Аня',
      text: xss,
    });
    expect(item?.ts).toBeGreaterThan(0);
  });

  it('системные и пользовательские сообщения лежат в одной истории по порядку', () => {
    const store = makeStore();
    store.join('r', 's1', 'Аня', ON);
    const author = store.getParticipant('r', 's1')!;

    store.addSystemMessage('r', 'join', 'Аня');
    store.addUserMessage('r', author, 'привет');
    store.addSystemMessage('r', 'leave', 'Борис');

    expect(store.get('r')?.messages.map((m) => m.type)).toEqual(['system', 'user', 'system']);
    expect(store.get('r')?.messages.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
  });

  it('★ история обрезается до maxMessages, оставляя последние сообщения', () => {
    const store = makeStore({ maxMessages: 5 });
    store.join('r', 's1', 'Аня', ON);
    const author = store.getParticipant('r', 's1')!;

    for (let i = 1; i <= 12; i++) store.addUserMessage('r', author, `сообщение ${i}`);

    const messages = store.get('r')!.messages;
    expect(messages).toHaveLength(5);
    expect(messages.map((m) => (m.type === 'user' ? m.text : ''))).toEqual([
      'сообщение 8',
      'сообщение 9',
      'сообщение 10',
      'сообщение 11',
      'сообщение 12',
    ]);
  });

  it('дефолтная глубина истории — 200 сообщений (Q8)', () => {
    const store = makeStore();
    store.join('r', 's1', 'Аня', ON);
    const author = store.getParticipant('r', 's1')!;

    for (let i = 0; i < DEFAULT_MAX_MESSAGES + 10; i++) store.addUserMessage('r', author, `${i}`);

    expect(store.get('r')?.messages).toHaveLength(DEFAULT_MAX_MESSAGES);
  });

  it('сообщение в несуществующую комнату не создаёт её', () => {
    const store = makeStore();

    expect(store.addSystemMessage('нет-такой', 'join', 'Аня')).toBeNull();
    expect(store.stats().rooms).toBe(0);
  });

  it('id сообщений уникальны при реальном генераторе', () => {
    const store = new RoomStore();
    store.join('r', 's1', 'Аня', ON);
    const author = store.getParticipant('r', 's1')!;

    const ids = new Set(
      Array.from({ length: 50 }, (_, i) => store.addUserMessage('r', author, `${i}`)?.id),
    );

    expect(ids.size).toBe(50);
  });
});

describe('updateMedia (ФТ-15…18)', () => {
  it('состояние устройств переживает переключение и попадает в снапшот', () => {
    const store = makeStore();
    store.join('r', 's1', 'Аня', ON);

    expect(store.updateMedia('r', 's1', { audio: false, video: true })).toBe(true);

    expect(store.snapshot('r')?.participants[0]?.media).toEqual({ audio: false, video: true });
  });

  it('для неизвестного участника или комнаты возвращает false', () => {
    const store = makeStore();
    store.join('r', 's1', 'Аня', ON);

    expect(store.updateMedia('r', 'чужой', ON)).toBe(false);
    expect(store.updateMedia('нет-такой', 's1', ON)).toBe(false);
  });
});

describe('snapshot и stats', () => {
  it('снапшот содержит всех участников и историю (основа ack room:join)', () => {
    const store = makeStore();
    store.join('r', 's1', 'Аня', ON);
    store.join('r', 's2', 'Борис', OFF);
    store.addSystemMessage('r', 'join', 'Аня');

    const snapshot = store.snapshot('r')!;

    expect(snapshot.id).toBe('r');
    expect(snapshot.participants.map((p) => p.name)).toEqual(['Аня', 'Борис']);
    expect(snapshot.messages).toHaveLength(1);
  });

  it('снапшот — копия: изменение результата не трогает состояние комнаты', () => {
    const store = makeStore();
    store.join('r', 's1', 'Аня', ON);

    const snapshot = store.snapshot('r')!;
    snapshot.participants.push({ id: 'подделка', name: 'X', media: ON, joinedAt: 0 });
    snapshot.messages.push({ type: 'system', id: 'x', kind: 'join', name: 'X', ts: 0 });

    expect(store.get('r')?.participants.size).toBe(1);
    expect(store.get('r')?.messages).toHaveLength(0);
  });

  it('снапшот несуществующей комнаты — undefined', () => {
    expect(makeStore().snapshot('нет-такой')).toBeUndefined();
  });

  it('stats суммирует участников по всем комнатам (источник для /health)', () => {
    const store = makeStore();
    store.join('a', 's1', 'A', ON);
    store.join('a', 's2', 'B', ON);
    store.join('b', 's3', 'C', ON);

    expect(store.stats()).toEqual({ rooms: 2, participants: 3 });

    store.leave('b', 's3');
    expect(store.stats()).toEqual({ rooms: 1, participants: 2 });
  });
});
