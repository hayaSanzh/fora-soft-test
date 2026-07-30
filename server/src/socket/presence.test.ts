/**
 * Integration-тесты контракта, часть 1: presence (задача IP 4.10, TDD §11.3).
 *
 * Сценарии 1, 2 и 6 из §11.3: вход четырёх, отказ пятому, гонка за последний
 * слот на реальных сокетах, обрыв соединения.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  collect,
  createHarness,
  expectSilence,
  MEDIA_OFF,
  MEDIA_ON,
  settle,
  waitFor,
  waitForMatch,
  type Harness,
} from './harness.test-utils.js';

let h: Harness;

afterEach(async () => {
  await h.close();
});

describe('room:join (ФТ-1, ФТ-4, ФТ-8, ФТ-26, TDD §11.3 п.1)', () => {
  it('★ четыре участника входят, каждый предыдущий получает peer:joined', async () => {
    h = await createHarness();

    const a = await h.join('room-1', 'Аня');
    expect(a.ack).toEqual({
      ok: true,
      self: expect.objectContaining({ name: 'Аня', media: MEDIA_ON }),
      room: expect.objectContaining({ id: 'room-1' }),
    });

    // Каждый из уже вошедших должен увидеть каждого следующего.
    const aSees = collect(a.client, 'peer:joined', 3);
    const b = await h.join('room-1', 'Борис');
    const bSees = collect(b.client, 'peer:joined', 2);
    const c = await h.join('room-1', 'Вера');
    const cSees = collect(c.client, 'peer:joined', 1);
    const d = await h.join('room-1', 'Глеб');

    expect((await aSees).map((p) => p.participant.name)).toEqual(['Борис', 'Вера', 'Глеб']);
    expect((await bSees).map((p) => p.participant.name)).toEqual(['Вера', 'Глеб']);
    expect((await cSees).map((p) => p.participant.name)).toEqual(['Глеб']);
    expect(d.ack.ok).toBe(true);
    expect(h.rooms.stats()).toEqual({ rooms: 1, participants: 4 });
  });

  it('ack содержит полный снапшот: всех участников и историю (один round-trip)', async () => {
    h = await createHarness();
    await h.join('room-1', 'Аня');
    await h.join('room-1', 'Борис');

    const { ack } = await h.join('room-1', 'Вера', MEDIA_OFF);

    expect(ack.ok).toBe(true);
    if (!ack.ok) return;
    expect(ack.room.participants.map((p) => p.name)).toEqual(['Аня', 'Борис', 'Вера']);
    expect(ack.self.name).toBe('Вера');
    expect(ack.self.media).toEqual(MEDIA_OFF);
    // Системные сообщения о входе предыдущих участников уже в истории.
    expect(ack.room.messages.map((m) => m.type)).toEqual(['system', 'system']);
    // ★ Собственного «вошёл» в снапшоте нет — он придёт событием, без дубля.
    expect(ack.room.messages.every((m) => m.type === 'system' && m.name !== 'Вера')).toBe(true);
  });

  it('★ вошедший получает своё системное сообщение событием ровно один раз', async () => {
    h = await createHarness();
    const client = await h.connect();

    // Подписка ДО входа: сообщение отправляется сразу после ack, и подписка
    // после await превратила бы тест в гонку.
    const own = collect(client, 'chat:message', 1);
    await client.emitWithAck('room:join', { roomId: 'room-1', name: 'Аня', media: MEDIA_ON });

    expect((await own)[0]).toMatchObject({ type: 'system', kind: 'join', name: 'Аня' });
    await expectSilence(client, 'chat:message');
  });

  it('неизвестный roomId создаёт комнату — состояния «не найдено» нет (ФТ-5)', async () => {
    h = await createHarness();

    const { ack } = await h.join('brand-new-room', 'Аня');

    expect(ack.ok).toBe(true);
    expect(h.rooms.get('brand-new-room')?.participants.size).toBe(1);
    // Кириллица в id не проходит формат ^[A-Za-z0-9_-]{4,64}$ (TDD §5.3).
    const cyrillic = await h.connect();
    expect(
      await cyrillic.emitWithAck('room:join', {
        roomId: 'совершенно-новая',
        name: 'Аня',
        media: MEDIA_ON,
      }),
    ).toEqual({ ok: false, error: 'INVALID_ROOM_ID' });
  });

  it('валидация: мусорный roomId и недопустимое имя отклоняются (ФТ-38)', async () => {
    h = await createHarness();
    const client = await h.connect();

    expect(
      await client.emitWithAck('room:join', {
        roomId: '../../etc/passwd',
        name: 'Аня',
        media: MEDIA_ON,
      }),
    ).toEqual({ ok: false, error: 'INVALID_ROOM_ID' });

    expect(
      await client.emitWithAck('room:join', {
        roomId: 'room-1',
        name: '<script>alert(1)</script>',
        media: MEDIA_ON,
      }),
    ).toEqual({ ok: false, error: 'INVALID_NAME' });

    // Ни одна из попыток не заняла слот.
    expect(h.rooms.stats()).toEqual({ rooms: 0, participants: 0 });
  });

  it('имя сохраняется очищенным, а не как пришло', async () => {
    h = await createHarness();

    const { ack } = await h.join('room-1', '  Анна​   Мария  ');

    expect(ack.ok && ack.self.name).toBe('Анна Мария');
  });

  it('мусор вместо media не мешает войти — устройства считаются выключенными (ФТ-14)', async () => {
    h = await createHarness();
    const client = await h.connect();

    const ack = await client.emitWithAck('room:join', {
      roomId: 'room-1',
      name: 'Аня',
      media: 'сломано' as never,
    });

    expect(ack.ok).toBe(true);
    expect(ack.ok && ack.self.media).toEqual(MEDIA_OFF);
  });

  it('повторный room:join в том же сокете → ALREADY_JOINED', async () => {
    h = await createHarness();
    const { client } = await h.join('room-1', 'Аня');

    expect(
      await client.emitWithAck('room:join', { roomId: 'room-2', name: 'Аня', media: MEDIA_ON }),
    ).toEqual({ ok: false, error: 'ALREADY_JOINED' });
    expect(h.rooms.stats()).toEqual({ rooms: 1, participants: 1 });
  });
});

describe('лимит 4 участника (ФТ-7, ФТ-8, US-5, TDD §11.3 п.2)', () => {
  it('★ пятому отвечает ROOM_FULL, остальные четверо продолжают работать', async () => {
    h = await createHarness();
    for (const name of ['Аня', 'Борис', 'Вера', 'Глеб']) await h.join('room-1', name);

    const fifth = await h.connect();
    const ack = await fifth.emitWithAck('room:join', {
      roomId: 'room-1',
      name: 'Пятый',
      media: MEDIA_ON,
    });

    expect(ack).toEqual({ ok: false, error: 'ROOM_FULL' });
    expect(h.rooms.stats()).toEqual({ rooms: 1, participants: 4 });
    // Отказ не рвёт соединение: клиент остаётся на экране «Комната заполнена».
    expect(fifth.connected).toBe(true);
  });

  it('★ два join в одном тике при 3 занятых слотах → ровно один ok:true', async () => {
    h = await createHarness();
    for (const name of ['Аня', 'Борис', 'Вера']) await h.join('room-1', name);

    const [x, y] = await Promise.all([h.connect(), h.connect()]);
    // Оба emit отправляются без ожидания друг друга: сервер обработает их
    // подряд в одном такте event loop — ровно ситуация US-5.
    const [ackX, ackY] = await Promise.all([
      x.emitWithAck('room:join', { roomId: 'room-1', name: 'X', media: MEDIA_ON }),
      y.emitWithAck('room:join', { roomId: 'room-1', name: 'Y', media: MEDIA_ON }),
    ]);

    const accepted = [ackX, ackY].filter((a) => a.ok);
    const rejected = [ackX, ackY].filter((a) => !a.ok);

    expect(accepted).toHaveLength(1);
    expect(rejected).toEqual([{ ok: false, error: 'ROOM_FULL' }]);
    expect(h.rooms.stats().participants).toBe(4);
  });

  it('★ десять одновременных входов в пустую комнату впускают ровно 4', async () => {
    h = await createHarness();
    const clients = await Promise.all(Array.from({ length: 10 }, () => h.connect()));

    const acks = await Promise.all(
      clients.map((c, i) =>
        c.emitWithAck('room:join', { roomId: 'race', name: `Участник ${i}`, media: MEDIA_ON }),
      ),
    );

    expect(acks.filter((a) => a.ok)).toHaveLength(4);
    expect(acks.filter((a) => !a.ok)).toHaveLength(6);
    expect(h.rooms.stats()).toEqual({ rooms: 1, participants: 4 });
  });

  it('после выхода участника освободившийся слот занимает следующий', async () => {
    h = await createHarness();
    const first = await h.join('room-1', 'Аня');
    for (const name of ['Борис', 'Вера', 'Глеб']) await h.join('room-1', name);

    first.client.emit('room:leave');
    await new Promise((r) => setTimeout(r, 100));

    const fifth = await h.connect();
    const ack = await fifth.emitWithAck('room:join', {
      roomId: 'room-1',
      name: 'Пятый',
      media: MEDIA_ON,
    });

    expect(ack.ok).toBe(true);
  });
});

describe('выход и обрыв (ФТ-25, ФТ-27, ФТ-28, ФТ-31, US-11, TDD §11.3 п.6)', () => {
  it('★ disconnect → peer:left и системное сообщение «покинул комнату»', async () => {
    h = await createHarness();
    const a = await h.join('room-1', 'Аня');
    const b = await h.join('room-1', 'Борис');

    await settle();
    const left = waitFor(a.client, 'peer:left');
    const system = waitForMatch(
      a.client,
      'chat:message',
      (m) => m.type === 'system' && m.kind === 'leave',
    );
    b.client.disconnect();

    expect(await left).toEqual({ id: expect.any(String), name: 'Борис' });
    expect(await system).toMatchObject({ type: 'system', kind: 'leave', name: 'Борис' });
    expect(h.rooms.stats()).toEqual({ rooms: 1, participants: 1 });
  });

  it('room:leave обрабатывается тем же путём, что и обрыв', async () => {
    h = await createHarness();
    const a = await h.join('room-1', 'Аня');
    const b = await h.join('room-1', 'Борис');

    await settle();
    const left = waitFor(a.client, 'peer:left');
    const system = waitForMatch(
      a.client,
      'chat:message',
      (m) => m.type === 'system' && m.kind === 'leave',
    );
    b.client.emit('room:leave');

    expect((await left).name).toBe('Борис');
    expect(await system).toMatchObject({ kind: 'leave', name: 'Борис' });
    // Сокет остался живым: сервер не рвёт соединение при выходе из комнаты.
    expect(b.client.connected).toBe(true);
  });

  it('★ выход последнего уничтожает комнату: повторный вход даёт пустую историю (ФТ-9)', async () => {
    h = await createHarness();
    const a = await h.join('room-1', 'Аня');
    await a.client.emitWithAck('chat:message', { text: 'секрет' });
    a.client.disconnect();
    await new Promise((r) => setTimeout(r, 100));

    expect(h.rooms.get('room-1')).toBeUndefined();
    const again = await h.join('room-1', 'Борис');

    expect(again.ack.ok && again.ack.room.messages).toEqual([]);
    expect(again.ack.ok && again.ack.room.participants).toHaveLength(1);
  });

  it('ушедший участник не получает событий комнаты', async () => {
    h = await createHarness();
    const a = await h.join('room-1', 'Аня');
    const b = await h.join('room-1', 'Борис');

    b.client.emit('room:leave');
    await new Promise((r) => setTimeout(r, 100));

    const silence = expectSilence(b.client, 'chat:message');
    await a.client.emitWithAck('chat:message', { text: 'вы меня слышите?' });
    await silence;
  });

  it('повторный room:leave безвреден', async () => {
    h = await createHarness();
    const a = await h.join('room-1', 'Аня');
    const b = await h.join('room-1', 'Борис');

    b.client.emit('room:leave');
    b.client.emit('room:leave');
    await new Promise((r) => setTimeout(r, 150));

    expect(h.rooms.stats()).toEqual({ rooms: 1, participants: 1 });
    expect(a.client.connected).toBe(true);
  });

  it('несколько вкладок одного пользователя — независимые участники (ФТ-29)', async () => {
    h = await createHarness();
    await h.join('room-1', 'Аня');
    const second = await h.join('room-1', 'Аня');

    expect(second.ack.ok).toBe(true);
    expect(h.rooms.stats()).toEqual({ rooms: 1, participants: 2 });
  });
});

/**
 * ★ Требование-отрицание: у создателя комнаты нет особых прав (ФТ-32).
 *
 * Такие требования легко считать выполненными «по умолчанию» и не проверять
 * вовсе — понятия «владелец» в коде действительно нет. Но именно поэтому оно и
 * уязвимо: привилегию первого участника ничего не мешает добавить позже, и
 * никакой тест не упадёт. Аудит трассировки в группе 16 показал, что ФТ-32 —
 * единственное требование PRD без единой ссылки в коде и тестах.
 */
describe('ФТ-32: все участники равны, у создателя нет привилегий', () => {
  it('★ в модели участника нет полей роли или владения', async () => {
    h = await createHarness();
    const creator = await h.join('room-1', 'Аня');

    expect(creator.ack.ok).toBe(true);
    if (!creator.ack.ok) return;

    // Ровно эти поля и никаких `isHost` / `owner` / `role`.
    expect(Object.keys(creator.ack.self).sort()).toEqual(['id', 'joinedAt', 'media', 'name']);
  });

  it('★ снимок комнаты не отличает создателя от остальных', async () => {
    h = await createHarness();
    await h.join('room-1', 'Аня');
    await h.join('room-1', 'Борис');
    const third = await h.join('room-1', 'Вера');

    expect(third.ack.ok).toBe(true);
    if (!third.ack.ok) return;

    const shapes = third.ack.room.participants.map((p) => Object.keys(p).sort().join(','));
    // Все участники описаны одинаковым набором полей.
    expect(new Set(shapes).size).toBe(1);
  });

  it('★ выход создателя не закрывает комнату и не меняет прав остальных', async () => {
    h = await createHarness();
    const creator = await h.join('room-1', 'Аня');
    const second = await h.join('room-1', 'Борис');

    creator.client.emit('room:leave');
    await waitFor(second.client, 'peer:left');

    // Комната жива, второй участник продолжает пользоваться ею полностью:
    // отправляет сообщение и получает его обратно рассылкой.
    expect(h.rooms.stats()).toEqual({ rooms: 1, participants: 1 });

    const third = await h.join('room-1', 'Вера');
    expect(third.ack.ok).toBe(true);

    const delivered = waitForMatch(third.client, 'chat:message', (m) => m.type === 'user');
    second.client.emit('chat:message', { text: 'создателя больше нет, всё работает' }, () => {});
    expect((await delivered).type).toBe('user');
  });
});
