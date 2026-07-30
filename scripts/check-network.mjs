#!/usr/bin/env node
/**
 * Проверка сетевых предусловий среды (задача IP 15.4, ФТ-34, риск R1).
 *
 * WebRTC без TURN требует от сети ровно двух вещей:
 *
 * 1. **Исходящий UDP до STUN-сервера и ответ на тот же порт.** Без этого клиент
 *    не узнает свой внешний адрес, соберёт только host-кандидатов, и звонок
 *    между разными сетями не состоится.
 * 2. **Произвольные высокие UDP-порты между клиентами.** Это проверяется только
 *    двумя машинами в разных сетях — скрипт такого сделать не может и честно об
 *    этом сообщает.
 *
 * ★ Почему это отдельный инструмент, а не пункт в документации: «UDP закрыт» —
 * самая частая причина, по которой приложение «не работает» в корпоративной
 * сети, при том что и клиент, и сервер полностью исправны. Симптом при этом —
 * плитка «Нет соединения с участником» (ФТ-34), то есть выглядит как дефект
 * приложения. Проверку нужно уметь выполнить за десять секунд перед разбором.
 *
 * Запуск:
 *   node scripts/check-network.mjs
 *   node scripts/check-network.mjs --server stun.l.google.com:19302 --timeout 3000
 *
 * Код возврата: 0 — предусловие выполнено, 1 — STUN недостижим.
 */
import { createSocket } from 'node:dgram';
import { randomBytes } from 'node:crypto';
import { argv, exit, stdout } from 'node:process';

/** Значение по умолчанию совпадает с дефолтом клиента (`client/src/config.ts`). */
const DEFAULT_SERVER = 'stun.l.google.com:19302';
const MAGIC_COOKIE = 0x2112a442;
const BINDING_REQUEST = 0x0001;
const BINDING_SUCCESS = 0x0101;
const ATTR_XOR_MAPPED_ADDRESS = 0x0020;

function parseArgs(args) {
  const result = { server: DEFAULT_SERVER, timeout: 3000 };
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--server' && args[i + 1]) result.server = args[i + 1];
    if (args[i] === '--timeout' && args[i + 1]) result.timeout = Number(args[i + 1]);
  }
  return result;
}

/** STUN Binding Request: 20-байтовый заголовок без атрибутов (RFC 5389). */
function bindingRequest() {
  const message = Buffer.alloc(20);
  message.writeUInt16BE(BINDING_REQUEST, 0);
  message.writeUInt16BE(0, 2); // длина тела
  message.writeUInt32BE(MAGIC_COOKIE, 4);
  const transactionId = randomBytes(12);
  transactionId.copy(message, 8);
  return { message, transactionId };
}

/**
 * Достаёт XOR-MAPPED-ADDRESS — внешний адрес, каким его видит STUN-сервер.
 * Адрес и порт замаскированы XOR'ом с magic cookie (RFC 5389 §15.2).
 */
function parseMappedAddress(response) {
  if (response.length < 20) return null;
  if (response.readUInt16BE(0) !== BINDING_SUCCESS) return null;

  let offset = 20;
  const end = 20 + response.readUInt16BE(2);
  while (offset + 4 <= end && offset + 4 <= response.length) {
    const type = response.readUInt16BE(offset);
    const length = response.readUInt16BE(offset + 2);
    const value = response.subarray(offset + 4, offset + 4 + length);

    if (type === ATTR_XOR_MAPPED_ADDRESS && value.length >= 8) {
      const family = value.readUInt8(1);
      const port = value.readUInt16BE(2) ^ (MAGIC_COOKIE >>> 16);
      if (family === 0x01) {
        const raw = value.readUInt32BE(4) ^ MAGIC_COOKIE;
        const ip = [raw >>> 24, (raw >>> 16) & 0xff, (raw >>> 8) & 0xff, raw & 0xff].join('.');
        return { ip, port };
      }
      // IPv6 здесь не разбираем: для вывода достаточно факта ответа.
      return { ip: 'IPv6', port };
    }
    // Атрибуты выровнены по 4 байта.
    offset += 4 + length + ((4 - (length % 4)) % 4);
  }
  return null;
}

async function probeStun({ server, timeout }) {
  const [host, portText] = server.split(':');
  const port = Number(portText ?? 3478);
  const socket = createSocket('udp4');
  const { message, transactionId } = bindingRequest();
  const startedAt = Date.now();

  return new Promise((resolve) => {
    const finish = (result) => {
      clearTimeout(timer);
      socket.removeAllListeners();
      socket.close(() => resolve(result));
    };

    const timer = setTimeout(
      () => finish({ ok: false, reason: `нет ответа за ${timeout} мс` }),
      timeout,
    );

    socket.on('error', (error) => finish({ ok: false, reason: error.message }));

    socket.on('message', (response) => {
      // Чужие датаграммы игнорируем: сверяем transaction ID.
      if (!response.subarray(8, 20).equals(transactionId)) return;
      const mapped = parseMappedAddress(response);
      finish(
        mapped
          ? { ok: true, mapped, rttMs: Date.now() - startedAt }
          : { ok: false, reason: 'ответ получен, но XOR-MAPPED-ADDRESS не разобран' },
      );
    });

    socket.send(message, port, host, (error) => {
      if (error) finish({ ok: false, reason: `отправка не удалась: ${error.message}` });
    });
  });
}

const options = parseArgs(argv.slice(2));
stdout.write(`Проверка сетевых предусловий WebRTC (задача 15.4)\n`);
stdout.write(`STUN-сервер: ${options.server}, таймаут ${options.timeout} мс\n\n`);

const result = await probeStun(options);

if (result.ok) {
  stdout.write(`✔ Исходящий UDP работает, ответ получен за ${result.rttMs} мс\n`);
  stdout.write(`  Внешний адрес этой машины: ${result.mapped.ip}:${result.mapped.port}\n\n`);
  stdout.write(`Что это значит: клиент сможет собрать srflx-кандидатов, и звонок между\n`);
  stdout.write(`разными сетями возможен без TURN — при условии, что NAT не симметричный.\n\n`);
  stdout.write(`★ Чего проверка НЕ подтверждает: прохождение произвольных высоких UDP-портов\n`);
  stdout.write(`  между двумя клиентами. Это проверяется только звонком между машинами в\n`);
  stdout.write(`  разных сетях (см. docs/manual-verification-video-chat-room.md, раздел 2).\n`);
  exit(0);
}

stdout.write(`✘ STUN недостижим: ${result.reason}\n\n`);
stdout.write(`Что это значит: исходящий UDP закрыт. В этой сети приложение\n`);
stdout.write(`НЕ ЗАРАБОТАЕТ между разными сетями — обхода без TURN нет (риск R1).\n`);
stdout.write(`Внутри одной подсети звонок состоится на host-кандидатах.\n\n`);
stdout.write(`Симптом для пользователя: плитка «Нет соединения с участником» (ФТ-34)\n`);
stdout.write(`при работающем чате и списке участников.\n`);
exit(1);
