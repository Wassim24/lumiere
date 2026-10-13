// Home-network discovery helpers (spec §4).
import { parseHello } from './miio';

/** Hosts of the /24 containing ip (the router blocks broadcast, so we sweep unicast). */
export function sweepHosts(ip: string): string[] {
  const parts = ip.split('.');
  if (parts.length !== 4) return [];
  const base = parts.slice(0, 3).join('.');
  const out: string[] = [];
  for (let i = 1; i < 255; i++) {
    const h = `${base}.${i}`;
    if (h !== ip) out.push(h);
  }
  return out;
}

export type Found = { ip: string; did: number; model?: string; name?: string; source: 'sweep' | 'ssdp'; props?: Record<string, string> };

export function parseSweepReply(ip: string, dataHex: string): Found | null {
  const h = parseHello(dataHex);
  return h ? { ip, did: h.did, source: 'sweep' } : null;
}

/** Parse a Yeelight SSDP response / NOTIFY. */
export function parseSsdp(text: string): Found | null {
  const headers: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  const loc = headers['location']?.match(/yeelight:\/\/([\d.]+):(\d+)/);
  if (!loc || !headers['id']) return null;
  return {
    ip: loc[1],
    did: parseInt(headers['id'], 16),
    model: headers['model'],
    name: headers["name"] || undefined,
    source: 'ssdp',
    props: headers,
  };
}

