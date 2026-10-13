import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeReply, encodeRequest, parseHello, pyJson, HELLO_HEX } from '../src/protocol/miio';
import { Coalescer, LanConnection, LanError, type LineTransport } from '../src/protocol/lan';
import { parseSsdp, sweepHosts } from '../src/protocol/discovery';
import { nodeCrypto } from './nodeCrypto';

const TOKEN = '00112233445566778899aabbccddeeff';

test('miIO vector (spec §2.1)', () => {
  assert.equal(nodeCrypto.md5(TOKEN), '6e8311168ee16d6aa1aa48c64145003c');
  const json = pyJson({ id: 1, method: 'get_prop', params: ['power'] });
  assert.equal(json, '{"id": 1, "method": "get_prop", "params": ["power"]}');
  const packet = encodeRequest(nodeCrypto, TOKEN, 0x12345678, 0x100, json);
  assert.equal(
    packet,
    '21310060000000001234567800000100b48befb3c74e712065c531170be6462f2a36b2b7afa85bd6a9f1ed82b485a3d68628cb0ba48901152cb9ce59f42b292529bf9211d2778169fd9d357e85849a2e25d4f0d47f115adceb952501d510df30',
  );
  assert.deepEqual(decodeReply(nodeCrypto, TOKEN, packet), { id: 1, method: 'get_prop', params: ['power'] });
});

test('hello parse', () => {
  assert.equal(HELLO_HEX.length, 64);
  const open = parseHello('21310020' + '00000000075bcd15' + '000003e8' + TOKEN);
  assert.deepEqual(open, { did: 123456789, stamp: 1000, token: TOKEN });
  assert.equal(parseHello('21310020' + '00000000075bcd15' + '000003e8' + 'f'.repeat(32))!.token, null);
  assert.equal(parseHello('21310020' + '00000000075bcd15' + '000003e8' + '0'.repeat(32))!.token, null);
  assert.equal(parseHello('dead'), null);
});

function fakeTransport(script: (line: string, emit: (l: string) => void) => void): LineTransport {
  return {
    open: async (_h, _p, _t, onLine) => ({
      write: async (t) => script(t.trim(), (l) => setTimeout(() => onLine(l), 1)),
      close: () => {},
    }),
  };
}

test('LAN: props notification before reply, and error', async () => {
  const props: any[] = [];
  const c = new LanConnection(
    fakeTransport((line, emit) => {
      const req = JSON.parse(line);
      emit('{"method":"props","params":{"power":"on"}}');
      if (req.method === 'bad') emit(JSON.stringify({ id: req.id, error: { code: -1, message: 'method not supported' } }));
      else emit(JSON.stringify({ id: req.id, result: ['ok'] }));
    }),
    '1.2.3.4',
  );
  c.onProps = (p) => props.push(p);
  assert.deepEqual(await c.request('set_power', ['on']), ['ok']);
  assert.deepEqual(props, [{ power: 'on' }]);
  await assert.rejects(c.request('bad'), (e: LanError) => e.code === -1 && /not supported/.test(e.message));
});

test('Coalescer keeps only latest and sends it', async () => {
  let t = 0;
  const sent: number[] = [];
  const co = new Coalescer(100, () => t);
  const push = (v: number) => co.push('bright', async () => sent.push(v));
  push(1); // immediate
  t = 10; push(2);
  t = 20; push(3);
  t = 30; push(4);
  assert.deepEqual(sent, [1]);
  co.flush('bright');
  assert.deepEqual(sent, [1, 4]);
});

test('discovery helpers', () => {
  const hosts = sweepHosts('192.168.144.7');
  assert.equal(hosts.length, 253);
  assert.ok(hosts.includes('192.168.144.5') && !hosts.includes('192.168.144.7'));
  const f = parseSsdp('HTTP/1.1 200 OK\r\nLocation: yeelight://192.168.1.239:55443\r\nid: 0x000000000015243f\r\nmodel: color\r\nname: \r\n');
  assert.equal(f!.ip, '192.168.1.239');
  assert.equal(f!.did, 0x15243f);
});
