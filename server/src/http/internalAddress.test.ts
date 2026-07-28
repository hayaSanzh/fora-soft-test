import { describe, expect, it } from 'vitest';
import { isInternalAddress, normalizeAddress } from './internalAddress.js';

describe('normalizeAddress', () => {
  it('разворачивает IPv4-mapped IPv6', () => {
    expect(normalizeAddress('::ffff:127.0.0.1')).toBe('127.0.0.1');
    expect(normalizeAddress('::FFFF:10.1.2.3')).toBe('10.1.2.3');
  });

  it('отбрасывает зону IPv6', () => {
    expect(normalizeAddress('fe80::1%eth0')).toBe('fe80::1');
  });
});

describe('isInternalAddress (Q11: /health только внутри сети)', () => {
  it('пропускает loopback', () => {
    expect(isInternalAddress('127.0.0.1')).toBe(true);
    expect(isInternalAddress('::1')).toBe(true);
    expect(isInternalAddress('::ffff:127.0.0.1')).toBe(true);
  });

  it('пропускает приватные диапазоны, включая сети docker (172.16.0.0/12)', () => {
    expect(isInternalAddress('10.0.0.7')).toBe(true);
    expect(isInternalAddress('192.168.1.10')).toBe(true);
    expect(isInternalAddress('172.17.0.1')).toBe(true);
    expect(isInternalAddress('172.31.255.254')).toBe(true);
  });

  it('не пропускает публичные адреса, похожие на приватные', () => {
    expect(isInternalAddress('172.15.0.1')).toBe(false);
    expect(isInternalAddress('172.32.0.1')).toBe(false);
    expect(isInternalAddress('11.0.0.1')).toBe(false);
    expect(isInternalAddress('192.169.0.1')).toBe(false);
    expect(isInternalAddress('203.0.113.5')).toBe(false);
  });

  it('не пропускает пустой и некорректный адрес', () => {
    expect(isInternalAddress(undefined)).toBe(false);
    expect(isInternalAddress('')).toBe(false);
    expect(isInternalAddress('не-адрес')).toBe(false);
    expect(isInternalAddress('999.1.1.1')).toBe(false);
  });

  it('уважает дополнительный allowlist из HEALTH_ALLOWLIST', () => {
    expect(isInternalAddress('203.0.113.5', ['203.0.113.'])).toBe(true);
    expect(isInternalAddress('203.0.114.5', ['203.0.113.'])).toBe(false);
    // Пустая строка в списке не должна открывать доступ всем.
    expect(isInternalAddress('203.0.113.5', [''])).toBe(false);
  });
});
