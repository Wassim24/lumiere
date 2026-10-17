// Glue between the pure protocol code and the Yeenet native module.
import Yeenet from '../../modules/yeenet';
import type { LineSocket, LineTransport } from '../protocol/lan';
import type { MiioCrypto } from '../protocol/miio';

export const nativeCrypto: MiioCrypto = {
  md5: (h) => Yeenet.md5(h),
  aesEncrypt: (k, iv, d) => Yeenet.aesEncrypt(k, iv, d),
  aesDecrypt: (k, iv, d) => Yeenet.aesDecrypt(k, iv, d),
};

type Handlers = { onLine: (l: string) => void; onClose: (e: string | null) => void };
const handlers = new Map<string, Handlers>();
let seq = 0;

Yeenet.addListener('onTcpLine', ({ id, line }) => handlers.get(id)?.onLine(line));
Yeenet.addListener('onTcpClose', ({ id, error }) => {
  const h = handlers.get(id);
  handlers.delete(id);
  h?.onClose(error);
});

export const nativeTransport: LineTransport = {
  async open(host, port, timeoutMs, onLine, onClose): Promise<LineSocket> {
    const id = `c${++seq}`;
    handlers.set(id, { onLine, onClose });
    try {
      await Yeenet.tcpOpen(id, host, port, timeoutMs);
    } catch (e) {
      handlers.delete(id);
      throw e;
    }
    return {
      write: (t) => Yeenet.tcpWrite(id, t),
      close: () => {
        Yeenet.tcpClose(id);
        const h = handlers.get(id);
        handlers.delete(id);
        h?.onClose(null);
      },
    };
  },
};

export { Yeenet };
