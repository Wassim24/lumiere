// Yeelight LAN text protocol (TCP 55443): one JSON object per line. See spec §2.2.
export const LAN_PORT = 55443;

export interface LineSocket {
  write(text: string): Promise<void>;
  close(): void;
}

export interface LineTransport {
  open(host: string, port: number, timeoutMs: number, onLine: (line: string) => void, onClose: (error: string | null) => void): Promise<LineSocket>;
}

export class LanError extends Error {
  constructor(message: string, readonly code?: number) {
    super(message);
  }
}

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout>; sock: LineSocket };

class ClosedError extends LanError {}

const BACKOFF = [1000, 2000, 5000, 10000];

/**
 * One persistent connection per bulb. Replies are matched by id; `props` notifications go to onProps.
 * Bulbs (or the simulator) may close the socket at any time: requests reconnect on demand, and when
 * `keepAlive` is on, the connection is re-established in the background with backoff.
 */
export class LanConnection {
  private sock: LineSocket | null = null;
  private opening: Promise<LineSocket> | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private retry = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private keepAlive = false;

  onProps: (props: Record<string, string>) => void = () => {};
  /** connected: socket opened. closed: an open socket was closed (reconnecting). failed: could not connect. */
  onStatus: (status: 'connected' | 'closed' | 'failed', error: string | null) => void = () => {};

  constructor(private transport: LineTransport, public host: string, private timeoutMs = 3000) {}

  get connected() {
    return this.sock !== null;
  }

  /** Start keeping the connection open (foreground). */
  start() {
    this.keepAlive = true;
    this.retry = 0;
    this.ensure().catch(() => {});
  }

  /** Close and stop reconnecting (background). */
  stop() {
    this.keepAlive = false;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const s = this.sock;
    this.sock = null;
    s?.close();
  }

  setHost(host: string) {
    if (host === this.host) return;
    this.host = host;
    const s = this.sock;
    this.sock = null;
    s?.close();
    if (this.keepAlive) this.ensure().catch(() => {});
  }

  private handleLine = (line: string) => {
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (typeof msg.id === 'number' && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id)!;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new LanError(msg.error.message ?? 'error', msg.error.code));
      else p.resolve(msg.result);
    } else if (msg.method === 'props' && msg.params) {
      this.onProps(msg.params);
    }
  };

  private ensure(): Promise<LineSocket> {
    if (this.sock) return Promise.resolve(this.sock);
    if (this.opening) return this.opening;
    const host = this.host;
    let mine: LineSocket | null = null;
    this.opening = this.transport
      .open(host, LAN_PORT, this.timeoutMs, this.handleLine, (error) => {
        if (!mine) return;
        const wasCurrent = this.sock === mine;
        if (wasCurrent) this.sock = null;
        this.failPending(mine);
        if (wasCurrent) {
          this.onStatus('closed', error);
          this.scheduleReconnect();
        }
      })
      .then((s) => {
        mine = s;
        this.opening = null;
        if (host !== this.host) {
          s.close();
          return this.ensure();
        }
        this.sock = s;
        this.retry = 0;
        this.onStatus('connected', null);
        return s;
      })
      .catch((e) => {
        this.opening = null;
        this.onStatus('failed', String(e?.message ?? e));
        this.scheduleReconnect();
        throw e;
      });
    return this.opening;
  }

  private scheduleReconnect() {
    if (!this.keepAlive || this.retryTimer) return;
    const delay = BACKOFF[Math.min(this.retry++, BACKOFF.length - 1)];
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.keepAlive && !this.sock) this.ensure().catch(() => {});
    }, delay);
  }

  private failPending(sock: LineSocket) {
    for (const [id, p] of this.pending) {
      if (p.sock !== sock) continue;
      this.pending.delete(id);
      clearTimeout(p.timer);
      p.reject(new ClosedError('connection closed'));
    }
  }

  /** Send a request; if the socket closes before the reply (simulator style), retry once on a fresh one. */
  async request(method: string, params: unknown[] = []): Promise<any> {
    try {
      return await this.requestOnce(method, params);
    } catch (e) {
      if (e instanceof ClosedError) return this.requestOnce(method, params);
      throw e;
    }
  }

  private async requestOnce(method: string, params: unknown[]): Promise<any> {
    const sock = await this.ensure();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new LanError(`timeout: ${method}`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer, sock });
      sock.write(JSON.stringify({ id, method, params }) + '\r\n').catch((e) => {
        if (!this.pending.delete(id)) return;
        clearTimeout(timer);
        if (this.sock === sock) this.sock = null;
        sock.close();
        reject(new ClosedError(String(e?.message ?? e)));
      });
    });
  }
}

/**
 * Throttle per key: at most one send every `intervalMs`; while waiting only the latest value is kept,
 * and the latest value is always eventually sent.
 */
export class Coalescer {
  private last = new Map<string, number>();
  private queued = new Map<string, () => Promise<unknown>>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private intervalMs = 333, private now: () => number = Date.now) {}

  push(key: string, send: () => Promise<unknown>) {
    const wait = (this.last.get(key) ?? -Infinity) + this.intervalMs - this.now();
    if (wait <= 0 && !this.timers.has(key)) {
      this.last.set(key, this.now());
      send().catch(() => {});
      return;
    }
    this.queued.set(key, send);
    if (!this.timers.has(key)) {
      this.timers.set(
        key,
        setTimeout(() => this.flush(key), Math.max(0, wait)),
      );
    }
  }

  /** Send the queued value for key now (e.g. on slider release). */
  flush(key: string) {
    const t = this.timers.get(key);
    if (t) clearTimeout(t);
    this.timers.delete(key);
    const send = this.queued.get(key);
    this.queued.delete(key);
    if (send) {
      this.last.set(key, this.now());
      send().catch(() => {});
    }
  }
}
