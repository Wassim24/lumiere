import { Yeenet } from './native';
import { HELLO_HEX, MIIO_PORT } from '../protocol/miio';
import { parseSsdp, parseSweepReply, sweepHosts, type Found } from '../protocol/discovery';

/** SSDP and unicast miIO sweep in parallel; results merged by did. */
export async function discover(): Promise<Found[]> {
  const wifi = Yeenet.getWifiInfo();
  if (!wifi.isWifi || !wifi.ip) return [];
  const [ssdp, sweep] = await Promise.all([
    Yeenet.ssdpSearch(1500).catch((e) => {
      console.warn('[discover] ssdp', String(e));
      return [];
    }),
    Yeenet.udpSweep(sweepHosts(wifi.ip), MIIO_PORT, HELLO_HEX, 1500).catch((e) => {
      console.warn('[discover] sweep', String(e));
      return [];
    }),
  ]);
  const byDid = new Map<number, Found>();
  for (const r of sweep) {
    const f = parseSweepReply(r.ip, r.data);
    if (f) byDid.set(f.did, f);
  }
  for (const r of ssdp) {
    const f = parseSsdp(r.text);
    if (f) byDid.set(f.did, { ...byDid.get(f.did), ...f });
  }
  return [...byDid.values()];
}

/** True when something answers on the LAN control port. */
export async function lanReachable(ip: string): Promise<boolean> {
  try {
    await Yeenet.tcpOpen('probe-' + ip, ip, 55443, 1500);
    Yeenet.tcpClose('probe-' + ip);
    return true;
  } catch {
    return false;
  }
}

/** Manual add: identify a bulb by IP (miIO hello for its did, LAN port must answer). */
export async function probeIp(ip: string): Promise<{ did: number } | null> {
  const { LanConnection } = await import('../protocol/lan');
  const { cmd } = await import('../protocol/commands');
  const { nativeTransport } = await import('./native');
  const { parseHello } = await import('../protocol/miio');
  const c = new LanConnection(nativeTransport, ip, 2000);
  try {
    await cmd.getProps(c);
  } catch {
    return null;
  } finally {
    c.stop();
  }
  const r = await Yeenet.udpRequest(ip, MIIO_PORT, HELLO_HEX, 1500, false).catch(() => null);
  const h = r ? parseHello(r) : null;
  // Without a did the lamp can't be re-found after an IP change; derive a stable local id from the IP.
  return { did: h?.did ?? -ip.split('.').reduce((a, b) => a * 256 + Number(b), 0) };
}
