// Cloud-free pairing (spec §3): join the bulb hotspot, enable LAN control, hand over the home Wi-Fi.
import { getCalendars } from 'expo-localization';
import { Yeenet, nativeCrypto } from './native';
import { discover } from './discover';
import { decodeReply, encodeRequest, HELLO_HEX, MIIO_PORT, parseHello, pyJson } from '../protocol/miio';
import { LanConnection } from '../protocol/lan';
import { cmd } from '../protocol/commands';
import { nativeTransport } from './native';

export type PairingStep = 'hotspot' | 'hello' | 'lan' | 'wifi' | 'return' | 'search';
export type PairingErrorCode = 'HotspotNotJoined' | 'NoHelloReply' | 'AlreadyProvisioned' | 'LanEnableFailed' | 'NotFoundAfterJoin' | 'Cancelled';

export class PairingError extends Error {
  constructor(readonly code: PairingErrorCode, message?: string) {
    super(message ?? code);
  }
}

export type PairingResult = { did: number; ip: string; model?: string; mac?: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function pair(opts: {
  ssid: string;
  password: string;
  onStep: (s: PairingStep) => void;
  cancelled: () => boolean;
}): Promise<PairingResult> {
  const { onStep, cancelled } = opts;
  const check = () => {
    if (cancelled()) throw new PairingError('Cancelled');
  };

  onStep('hotspot');
  let gateway: string;
  try {
    ({ gateway } = await Yeenet.joinHotspot('yeelink-light-', 60_000));
  } catch (e) {
    throw new PairingError('HotspotNotJoined', e instanceof Error ? e.message : undefined);
  }
  let info: { model?: string; mac?: string } = {};
  let did = 0;
  try {
    check();
    onStep('hello');
    gateway = gateway || '192.168.10.1';
    let hello = null;
    for (let i = 0; i < 8 && !hello; i++) {
      check();
      const r = await Yeenet.udpRequest(gateway, MIIO_PORT, HELLO_HEX, 1500, true).catch(() => null);
      hello = r ? parseHello(r) : null;
      if (!hello) await sleep(500);
    }
    if (!hello) throw new PairingError('NoHelloReply');
    if (!hello.token) throw new PairingError('AlreadyProvisioned');
    const token = hello.token;
    did = hello.did;
    let msgId = Math.floor(Date.now() / 1000) % 10000;

    const send = async (method: string, params: unknown) => {
      const h = parseHello((await Yeenet.udpRequest(gateway, MIIO_PORT, HELLO_HEX, 1500, true)) ?? '');
      if (!h) throw new PairingError('NoHelloReply');
      const pkt = encodeRequest(nativeCrypto, token, h.did, h.stamp + 1, pyJson({ id: ++msgId, method, params }));
      const reply = await Yeenet.udpRequest(gateway, MIIO_PORT, pkt, 3000, true);
      if (!reply) return null;
      const msg = decodeReply(nativeCrypto, token, reply);
      if (msg.error) throw new Error(JSON.stringify(msg.error));
      return msg.result;
    };

    const res = await send('miIO.info', []).catch(() => null);
    if (res && typeof res === 'object') info = { model: res.model, mac: res.mac };

    check();
    onStep('lan');
    let ok = false;
    for (let i = 0; i < 3 && !ok; i++) {
      const r = await send('set_ps', ['cfg_lan_ctrl', '1']).catch(() => null);
      ok = Array.isArray(r) && r[0] === 'ok';
    }
    if (!ok) throw new PairingError('LanEnableFailed');

    check();
    onStep('wifi');
    const tz = getCalendars()[0]?.timeZone || 'Europe/Paris';
    // The bulb may switch networks before replying: a timeout here is not a failure.
    await send('miIO.config_router', { ssid: opts.ssid, passwd: opts.password, uid: 0, tz }).catch(() => null);
  } finally {
    onStep('return');
    Yeenet.releaseHotspot();
  }

  onStep('search');
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    check();
    await sleep(3000);
    const wifi = Yeenet.getWifiInfo();
    if (!wifi.isWifi) continue;
    const found = (await discover().catch(() => [])).find((f) => f.did === did);
    if (!found) continue;
    const c = new LanConnection(nativeTransport, found.ip);
    try {
      await cmd.getProps(c);
      return { did, ip: found.ip, ...info };
    } catch {
      // LAN port not up yet; keep trying.
    } finally {
      c.stop();
    }
  }
  throw new PairingError('NotFoundAfterJoin');
}
