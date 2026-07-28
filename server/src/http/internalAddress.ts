/**
 * Определение «внутреннего» адреса для `/health` (Q11, TDD §14.2, §10.4).
 *
 * Проверка живёт в приложении, а не только в nginx: контейнер может оказаться
 * доступен напрямую (docker-compose, k8s port-forward, ошибка в конфиге прокси),
 * и тогда единственная линия защиты — вот эта функция.
 */

/** Нормализует IPv4-mapped IPv6 (`::ffff:127.0.0.1`) и зону (`fe80::1%eth0`). */
export function normalizeAddress(address: string): string {
  const withoutZone = address.split('%')[0] ?? address;
  const lower = withoutZone.toLowerCase();
  return lower.startsWith('::ffff:') ? lower.slice('::ffff:'.length) : lower;
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split('.');
  if (parts.length !== 4) return false;
  const octets = parts.map((p) => Number(p));
  if (octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return false;
  const [a, b] = octets as [number, number, number, number];
  if (a === 127) return true; // loopback 127.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 (сюда попадают сети docker)
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 169 && b === 254) return true; // link-local
  return false;
}

function isPrivateIpv6(address: string): boolean {
  if (address === '::1' || address === '::') return true;
  // fc00::/7 — unique local; fe80::/10 — link-local.
  return /^f[cd][0-9a-f]{2}:/.test(address) || /^fe[89ab][0-9a-f]:/.test(address);
}

/**
 * @param address       адрес источника запроса (`req.ip`)
 * @param extraPrefixes дополнительные разрешённые адреса/префиксы из `HEALTH_ALLOWLIST`
 */
export function isInternalAddress(
  address: string | undefined,
  extraPrefixes: readonly string[] = [],
): boolean {
  if (address === undefined || address === '') return false;
  const normalized = normalizeAddress(address);
  if (isPrivateIpv4(normalized) || isPrivateIpv6(normalized)) return true;
  return extraPrefixes.some((prefix) => {
    const p = normalizeAddress(prefix);
    return p.length > 0 && normalized.startsWith(p);
  });
}
