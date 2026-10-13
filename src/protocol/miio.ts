// miIO binary protocol (UDP 54321), used only while pairing. See spec §2.1.
import { fromHex, hexUtf8, toHex, utf8Hex } from './hex';

export const MIIO_PORT = 54321;
export const HELLO_HEX = '21310020' + 'ff'.repeat(28);

export interface MiioCrypto {
  md5(hex: string): string;
  aesEncrypt(keyHex: string, ivHex: string, dataHex: string): string;
  aesDecrypt(keyHex: string, ivHex: string, dataHex: string): string;
}

export type Hello = { did: number; stamp: number; token: string | null };

/** Parse a 32-byte hello reply. token is null when the bulb hides it (already provisioned). */
export function parseHello(hex: string): Hello | null {
  if (hex.length < 64 || !hex.startsWith('2131')) return null;
  const did = parseInt(hex.slice(8, 24), 16);
  const stamp = parseInt(hex.slice(24, 32), 16);
  const token = hex.slice(32, 64).toLowerCase();
  const hidden = token === 'f'.repeat(32) || token === '0'.repeat(32);
  return { did, stamp, token: hidden ? null : token };
}

/** JSON with Python's default separators (", " and ": "), as the reference implementation sends. */
export function pyJson(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(pyJson).join(', ') + ']';
  if (v && typeof v === 'object')
    return '{' + Object.entries(v).map(([k, x]) => JSON.stringify(k) + ': ' + pyJson(x)).join(', ') + '}';
  return JSON.stringify(v);
}

function keys(c: MiioCrypto, token: string) {
  const key = c.md5(token);
  return { key, iv: c.md5(key + token) };
}

function hex(n: number, bytes: number) {
  return n.toString(16).padStart(bytes * 2, '0');
}

export function encodeRequest(c: MiioCrypto, token: string, did: number, stamp: number, json: string): string {
  const { key, iv } = keys(c, token);
  const body = c.aesEncrypt(key, iv, utf8Hex(json));
  const header = '2131' + hex(32 + body.length / 2, 2) + hex(did, 8) + hex(stamp, 4);
  return header + c.md5(header + token + body) + body;
}

export function decodeReply(c: MiioCrypto, token: string, packetHex: string): any {
  const p = packetHex.toLowerCase();
  if (c.md5(p.slice(0, 32) + token + p.slice(64)) !== p.slice(32, 64)) throw new Error('bad checksum');
  const { key, iv } = keys(c, token);
  const plain = hexUtf8(c.aesDecrypt(key, iv, p.slice(64))).replace(/\0+$/, '');
  return JSON.parse(plain);
}

export { fromHex, toHex };
