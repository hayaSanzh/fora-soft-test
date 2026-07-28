/**
 * Тесты передачи имени в комнату (задача IP 5.3, ФТ-28).
 *
 * Регрессия, найденная на ручной приёмке группы 5: имя передавалось через
 * `location.state` react-router, а оно сериализуется в запись истории и
 * **переживает F5** — перезагрузка не спрашивала имя заново, хотя ФТ-28 требует
 * считать её новым входом.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { clearPendingJoin, readPendingJoin, setPendingJoin } from './pendingJoin';

afterEach(() => clearPendingJoin());

describe('pendingJoin', () => {
  it('отдаёт имя для той комнаты, для которой оно записано', () => {
    setPendingJoin('RoomAAA', 'Анна-Мария');

    expect(readPendingJoin('RoomAAA')).toBe('Анна-Мария');
  });

  it('★ не отдаёт имя для другой комнаты — ссылка на чужую комнату не подхватит его', () => {
    setPendingJoin('RoomAAA', 'Аня');

    expect(readPendingJoin('RoomBBB')).toBeNull();
  });

  it('★ чтение идемпотентно: двойной рендер в StrictMode не теряет имя', () => {
    setPendingJoin('RoomAAA', 'Аня');

    expect(readPendingJoin('RoomAAA')).toBe('Аня');
    expect(readPendingJoin('RoomAAA')).toBe('Аня');
  });

  it('пустое состояние отдаёт null', () => {
    expect(readPendingJoin('RoomAAA')).toBeNull();
  });

  it('clearPendingJoin забывает имя (возврат к вводу, выход из комнаты)', () => {
    setPendingJoin('RoomAAA', 'Аня');
    clearPendingJoin();

    expect(readPendingJoin('RoomAAA')).toBeNull();
  });

  it('повторная запись перезаписывает предыдущую', () => {
    setPendingJoin('RoomAAA', 'Аня');
    setPendingJoin('RoomBBB', 'Борис');

    expect(readPendingJoin('RoomAAA')).toBeNull();
    expect(readPendingJoin('RoomBBB')).toBe('Борис');
  });

  it('★ состояние живёт только в памяти модуля — перезагрузка его теряет', async () => {
    setPendingJoin('RoomAAA', 'Аня');

    // Перезагрузка страницы = новый экземпляр модуля. Эмулируем свежим импортом
    // с уникальным query: у него собственная переменная `pending`.
    const fresh = (await import(`./pendingJoin?reload=${Date.now()}`)) as {
      readPendingJoin: (roomId: string) => string | null;
    };

    expect(fresh.readPendingJoin('RoomAAA')).toBeNull();
  });
});
