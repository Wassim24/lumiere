import { createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import net from 'node:net';
import type { MiioCrypto } from '../src/protocol/miio';
import type { LineTransport } from '../src/protocol/lan';

export const nodeCrypto: MiioCrypto = {
  md5: (h) => createHash('md5').update(Buffer.from(h, 'hex')).digest('hex'),
  aesEncrypt: (k, iv, d) => {
    const c = createCipheriv('aes-128-cbc', Buffer.from(k, 'hex'), Buffer.from(iv, 'hex'));
    return Buffer.concat([c.update(Buffer.from(d, 'hex')), c.final()]).toString('hex');
  },
  aesDecrypt: (k, iv, d) => {
    const c = createDecipheriv('aes-128-cbc', Buffer.from(k, 'hex'), Buffer.from(iv, 'hex'));
    return Buffer.concat([c.update(Buffer.from(d, 'hex')), c.final()]).toString('hex');
  },
};

export const nodeTransport: LineTransport = {
  open: (host, port, timeoutMs, onLine, onClose) =>
    new Promise((resolve, reject) => {
      const s = net.connect({ host, port, timeout: timeoutMs });
      let buf = '';
      s.once('connect', () => {
        s.setTimeout(0);
        resolve({ write: (t) => new Promise((r, j) => s.write(t, (e) => (e ? j(e) : r()))), close: () => s.destroy() });
      });
      s.once('timeout', () => { s.destroy(); reject(new Error('timeout')); });
      s.on('data', (d) => {
        buf += d.toString();
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (line) onLine(line);
        }
      });
      s.once('error', (e) => reject(e));
      s.once('close', () => onClose(null));
    }),
};
