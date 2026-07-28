/**
 * Integration-тесты контракта, часть 2 (задача IP 4.11, TDD §11.3 п.3–5, 7, 8):
 * релей сигналинга, изоляция комнат, порядок сообщений чата, история для
 * позднего участника, `media:state` в снапшоте, антифлуд.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { SdpDescription } from '@video-chat/shared';
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
const OFFER: SdpDescription = { type: 'offer', sdp: 'v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\n' };
const ANSWER: SdpDescription = { type: 'answer', sdp: 'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n' };
const CANDIDATE = {
  candidate: 'candidate:1 1 UDP 2130706431 192.168.1.5 54321 typ host',
  sdpMid: '0',
  sdpMLineIndex: 0,
};

afterEach(async () => {
  await h.close();
});

describe('релей сигналинга (ФТ-10, TDD §11.3 п.3)', () => {
  it('★ offer доходит адресату с корректным from', async () => {
    h = await createHarness();
    const a = await h.join('room-1', 'Аня');
    const b = await h.join('room-1', 'Борис');
    const selfIdA = a.ack.ok ? a.ack.self.id : '';
    const selfIdB = b.ack.ok ? b.ack.self.id : '';

    const incoming = waitFor(b.client, 'signal:offer');
    a.client.emit('signal:offer', { to: selfIdB, sdp: OFFER });

    expect(await incoming).toEqual({ from: selfIdA, sdp: OFFER });
  });

  it('answer и ice релеятся так же', async () => {
    h = await createHarness();
    const a = await h.join('room-1', 'Аня');
    const b = await h.join('room-1', 'Борис');
    const idA = a.ack.ok ? a.ack.self.id : '';
    const idB = b.ack.ok ? b.ack.self.id : '';

    const answer = waitFor(a.client, 'signal:answer');
    const ice = waitFor(a.client, 'signal:ice');
    b.client.emit('signal:answer', { to: idA, sdp: ANSWER });
    b.client.emit('signal:ice', { to: idA, candidate: CANDIDATE });

    expect(await answer).toEqual({ from: idB, sdp: ANSWER });
    expect(await ice).toEqual({ from: idB, candidate: CANDIDATE });
  });

  it('★ from нельзя подделать: сервер подставляет его сам', async () => {
    h = await createHarness();
    const a = await h.join('room-1', 'Аня');
    const b = await h.join('room-1', 'Борис');
    const idA = a.ack.ok ? a.ack.self.id : '';
    const idB = b.ack.ok ? b.ack.self.id : '';

    const incoming = waitFor(b.client, 'signal:offer');
    // Клиент пытается выдать себя за другого участника.
    a.client.emit('signal:offer', { to: idB, from: 'подделка', sdp: OFFER } as never);

    expect((await incoming).from).toBe(idA);
  });

  it('★ сокет из ДРУГОЙ комнаты сигналинг не получает (TDD §11.3 п.4)', async () => {
    h = await createHarness();
    const a = await h.join('room-1', 'Аня');
    const outsider = await h.join('room-2', 'Чужой');
    const outsiderId = outsider.ack.ok ? outsider.ack.self.id : '';

    const silence = expectSilence(outsider.client, 'signal:offer');
    a.client.emit('signal:offer', { to: outsiderId, sdp: OFFER });
    await silence;
  });

  it('сигналинг на несуществующий id отбрасывается молча, сокет живёт', async () => {
    h = await createHarness();
    const a = await h.join('room-1', 'Аня');

    a.client.emit('signal:offer', { to: 'нет-такого-сокета', sdp: OFFER });
    await settle(150);

    expect(a.client.connected).toBe(true);
  });

  it('сокет без room:join не может слать сигналинг (NOT_IN_ROOM, задача 4.2)', async () => {
    h = await createHarness();
    const joined = await h.join('room-1', 'Аня');
    const joinedId = joined.ack.ok ? joined.ack.self.id : '';
    const stranger = await h.connect();

    const silence = expectSilence(joined.client, 'signal:offer');
    stranger.emit('signal:offer', { to: joinedId, sdp: OFFER });
    await silence;
  });

  it('сигналинг самому себе доходит до себя же — это валидный адресат', async () => {
    h = await createHarness();
    const a = await h.join('room-1', 'Аня');
    const idA = a.ack.ok ? a.ack.self.id : '';

    const incoming = waitFor(a.client, 'signal:ice');
    a.client.emit('signal:ice', { to: idA, candidate: CANDIDATE });

    expect((await incoming).from).toBe(idA);
  });
});

describe('чат (ФТ-21…25, TDD §11.3 п.5, 7)', () => {
  it('сообщение приходит всем, включая автора, с именем и серверным ts', async () => {
    h = await createHarness();
    const a = await h.join('room-1', 'Аня');
    const b = await h.join('room-1', 'Борис');
    await settle();

    const atA = waitForMatch(a.client, 'chat:message', (m) => m.type === 'user');
    const atB = waitForMatch(b.client, 'chat:message', (m) => m.type === 'user');
    const ack = await a.client.emitWithAck('chat:message', { text: 'привет' });

    expect(ack).toEqual({ ok: true, id: expect.any(String) });
    for (const item of [await atA, await atB]) {
      expect(item).toMatchObject({
        type: 'user',
        authorName: 'Аня',
        text: 'привет',
        id: ack.ok ? ack.id : '',
      });
      expect((item as { ts: number }).ts).toBeGreaterThan(0);
    }
  });

  it('★ порядок 50 сообщений сохранён у получателя (TDD §11.3 п.5)', async () => {
    // Лимит чата поднят намеренно: с дефолтными burst 5 + 1/с отправить 50
    // сообщений подряд невозможно и живому человеку — это проверяется
    // отдельным тестом антифлуда. Здесь проверяется именно порядок доставки.
    h = await createHarness({ chatBurst: 100 });
    const a = await h.join('room-1', 'Аня');
    const b = await h.join('room-1', 'Борис');
    await settle();

    const received = collect(b.client, 'chat:message', 50);
    for (let i = 1; i <= 50; i++)
      a.client.emit('chat:message', { text: `сообщение ${i}` }, () => {});

    const texts = (await received).map((m) => (m.type === 'user' ? m.text : ''));
    expect(texts).toEqual(Array.from({ length: 50 }, (_, i) => `сообщение ${i + 1}`));
  });

  it('★ поздний клиент получает историю переписки до своего входа (ФТ-23)', async () => {
    h = await createHarness();
    const a = await h.join('room-1', 'Аня');
    await a.client.emitWithAck('chat:message', { text: 'первое' });
    await a.client.emitWithAck('chat:message', { text: 'второе' });

    const late = await h.join('room-1', 'Поздний');

    expect(late.ack.ok).toBe(true);
    if (!late.ack.ok) return;
    const texts = late.ack.room.messages
      .filter((m) => m.type === 'user')
      .map((m) => (m.type === 'user' ? m.text : ''));
    expect(texts).toEqual(['первое', 'второе']);
  });

  it('история обрезается до maxMessages, поздний участник получает последние', async () => {
    h = await createHarness({ maxMessages: 3, chatBurst: 100 });
    const a = await h.join('room-1', 'Аня');
    for (let i = 1; i <= 6; i++) await a.client.emitWithAck('chat:message', { text: `${i}` });

    const late = await h.join('room-1', 'Поздний');

    expect(late.ack.ok && late.ack.room.messages).toHaveLength(3);
    expect(
      late.ack.ok &&
        late.ack.room.messages.map((m) => (m.type === 'user' ? m.text : m.kind)).join(','),
    ).toBe('4,5,6');
  });

  it('★ XSS-проба сохраняется как есть — экранирование только при рендере (ФТ-39)', async () => {
    h = await createHarness();
    const a = await h.join('room-1', 'Аня');
    const b = await h.join('room-1', 'Борис');
    await settle();

    const xss = '<img src=x onerror=alert(1)>';
    const atB = waitForMatch(b.client, 'chat:message', (m) => m.type === 'user');
    await a.client.emitWithAck('chat:message', { text: xss });

    expect((await atB) as { text: string }).toMatchObject({ text: xss });
  });

  it('пустой текст и превышение длины отклоняются с разными кодами (ФТ-24)', async () => {
    h = await createHarness();
    const a = await h.join('room-1', 'Аня');

    expect(await a.client.emitWithAck('chat:message', { text: '   ' })).toEqual({
      ok: false,
      error: 'EMPTY_TEXT',
    });
    expect(await a.client.emitWithAck('chat:message', { text: 'x'.repeat(501) })).toEqual({
      ok: false,
      error: 'TEXT_TOO_LONG',
    });
    // Отклонённые сообщения в историю не попали.
    expect(h.rooms.get('room-1')?.messages.filter((m) => m.type === 'user')).toHaveLength(0);
  });

  it('сокет без room:join получает NOT_IN_ROOM (задача 4.2)', async () => {
    h = await createHarness();
    const stranger = await h.connect();

    expect(await stranger.emitWithAck('chat:message', { text: 'привет' })).toEqual({
      ok: false,
      error: 'NOT_IN_ROOM',
    });
  });

  it('сообщение доходит только в свою комнату', async () => {
    h = await createHarness();
    const a = await h.join('room-1', 'Аня');
    const other = await h.join('room-2', 'Чужой');
    await settle();

    const silence = expectSilence(other.client, 'chat:message');
    await a.client.emitWithAck('chat:message', { text: 'секрет' });
    await silence;
  });

  it('сообщение переживает уход автора: имя записано в сообщение (TDD §8.2)', async () => {
    h = await createHarness();
    const a = await h.join('room-1', 'Аня');
    const b = await h.join('room-1', 'Борис');
    await a.client.emitWithAck('chat:message', { text: 'я ушла' });
    a.client.disconnect();
    await settle();

    const late = await h.join('room-1', 'Поздний');

    expect(
      late.ack.ok && late.ack.room.messages.find((m) => m.type === 'user' && m.text === 'я ушла'),
    ).toMatchObject({ authorName: 'Аня' });
    expect(b.client.connected).toBe(true);
  });
});

describe('media:state (ФТ-15…18, TDD §11.3 п.7)', () => {
  it('★ состояние ретранслируется остальным с id участника', async () => {
    h = await createHarness();
    const a = await h.join('room-1', 'Аня');
    const b = await h.join('room-1', 'Борис');
    const idA = a.ack.ok ? a.ack.self.id : '';

    const incoming = waitFor(b.client, 'media:state');
    a.client.emit('media:state', { audio: false, video: true });

    expect(await incoming).toEqual({ id: idA, media: { audio: false, video: true } });
  });

  it('★ состояние попадает в снапшот следующего входящего (иначе он увидит чёрный экран)', async () => {
    h = await createHarness();
    const a = await h.join('room-1', 'Аня', MEDIA_ON);
    a.client.emit('media:state', { audio: false, video: false });
    await settle();

    const late = await h.join('room-1', 'Поздний');

    expect(late.ack.ok && late.ack.room.participants.find((p) => p.name === 'Аня')?.media).toEqual(
      MEDIA_OFF,
    );
  });

  it('автор своего media:state обратно не получает', async () => {
    h = await createHarness();
    const a = await h.join('room-1', 'Аня');
    await h.join('room-1', 'Борис');

    const silence = expectSilence(a.client, 'media:state');
    a.client.emit('media:state', MEDIA_OFF);
    await silence;
  });

  it('мусорный payload и сокет без комнаты игнорируются', async () => {
    h = await createHarness();
    const a = await h.join('room-1', 'Аня', MEDIA_ON);
    const b = await h.join('room-1', 'Борис');
    const stranger = await h.connect();

    const silence = expectSilence(b.client, 'media:state');
    a.client.emit('media:state', 'сломано' as never);
    stranger.emit('media:state', MEDIA_OFF);
    await silence;

    // Состояние в сторе не испорчено.
    expect(h.rooms.getParticipant('room-1', a.ack.ok ? a.ack.self.id : '')?.media).toEqual(
      MEDIA_ON,
    );
  });
});

describe('антифлуд (ФТ-40, TDD §10.4, §11.3 п.8)', () => {
  it('★ флуд в чат даёт RATE_LIMITED и НЕ рвёт сокет', async () => {
    h = await createHarness({ chatBurst: 3, chatRefillPerSec: 0 });
    const a = await h.join('room-1', 'Аня');

    const acks = [];
    for (let i = 0; i < 6; i++) {
      acks.push(await a.client.emitWithAck('chat:message', { text: `сообщение ${i}` }));
    }

    expect(acks.filter((x) => x.ok)).toHaveLength(3);
    expect(acks.filter((x) => !x.ok)).toEqual([
      { ok: false, error: 'RATE_LIMITED' },
      { ok: false, error: 'RATE_LIMITED' },
      { ok: false, error: 'RATE_LIMITED' },
    ]);
    expect(a.client.connected).toBe(true);
    // Отклонённые сообщения в историю не попали.
    expect(h.rooms.get('room-1')?.messages.filter((m) => m.type === 'user')).toHaveLength(3);
  });

  it('токены пополняются со временем — пауза возвращает возможность писать', async () => {
    let clock = 1_000_000;
    h = await createHarness({ chatBurst: 2, chatRefillPerSec: 1, now: () => clock });
    const a = await h.join('room-1', 'Аня');

    await a.client.emitWithAck('chat:message', { text: '1' });
    await a.client.emitWithAck('chat:message', { text: '2' });
    expect(await a.client.emitWithAck('chat:message', { text: '3' })).toEqual({
      ok: false,
      error: 'RATE_LIMITED',
    });

    clock += 1_500; // прошло 1.5 с → +1 токен
    expect(await a.client.emitWithAck('chat:message', { text: '4' })).toMatchObject({ ok: true });
  });

  it('★ флуд сигналингом отключает сокет (остальные продолжают работать)', async () => {
    h = await createHarness({ signalMax: 5, signalWindowMs: 10_000 });
    const a = await h.join('room-1', 'Аня');
    const b = await h.join('room-1', 'Борис');
    const idB = b.ack.ok ? b.ack.self.id : '';

    const disconnected = new Promise<string>((resolve) => a.client.on('disconnect', resolve));
    for (let i = 0; i < 20; i++) a.client.emit('signal:ice', { to: idB, candidate: CANDIDATE });

    await disconnected;
    expect(a.client.connected).toBe(false);
    // Отключение одного не задело комнату остальных.
    expect(b.client.connected).toBe(true);
    await settle();
    expect(h.rooms.stats().participants).toBe(1);
  });

  it('лимит чата у каждого сокета свой', async () => {
    h = await createHarness({ chatBurst: 1, chatRefillPerSec: 0 });
    const a = await h.join('room-1', 'Аня');
    const b = await h.join('room-1', 'Борис');

    expect(await a.client.emitWithAck('chat:message', { text: 'от Ани' })).toMatchObject({
      ok: true,
    });
    expect(await a.client.emitWithAck('chat:message', { text: 'ещё от Ани' })).toEqual({
      ok: false,
      error: 'RATE_LIMITED',
    });
    // У Бориса собственный бакет — его сообщение проходит.
    expect(await b.client.emitWithAck('chat:message', { text: 'от Бориса' })).toMatchObject({
      ok: true,
    });
  });
});
