// Integration against reference/fakebulb.py (started by the test).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import dgram from 'node:dgram';
import { LanConnection } from '../src/protocol/lan';
import { cmd } from '../src/protocol/commands';
import { decodeReply, encodeRequest, HELLO_HEX, parseHello, pyJson } from '../src/protocol/miio';
import { nodeCrypto, nodeTransport } from './nodeCrypto';

function udp(hex: string): Promise<string> {
  return new Promise((res, rej) => {
    const s = dgram.createSocket('udp4');
    const t = setTimeout(() => { s.close(); rej(new Error('udp timeout')); }, 2000);
    s.on('message', (m) => { clearTimeout(t); s.close(); res(m.toString('hex')); });
    s.send(Buffer.from(hex, 'hex'), 54321, '127.0.0.1');
  });
}

test('fakebulb end-to-end', async (t) => {
  const p = spawn('python3', [new URL('../reference/fakebulb.py', import.meta.url).pathname]);
  t.after(() => p.kill());
  await new Promise((r) => setTimeout(r, 600));

  const h = parseHello(await udp(HELLO_HEX))!;
  assert.equal(h.did, 123456789);
  assert.ok(h.token);
  const pkt = encodeRequest(nodeCrypto, h.token!, h.did, h.stamp + 1, pyJson({ id: 7, method: 'set_ps', params: ['cfg_lan_ctrl', '1'] }));
  assert.deepEqual(decodeReply(nodeCrypto, h.token!, await udp(pkt)).result, ['ok']);

  const c = new LanConnection(nodeTransport, '127.0.0.1');
  const notes: any[] = [];
  c.onProps = (x) => notes.push(x);
  await cmd.sceneCt(c, 3000, 90);
  const props = await cmd.getProps(c);
  assert.equal(props.ct, '3000');
  assert.equal(props.bright, '90');
  await cmd.cronAdd(c, 30);
  assert.deepEqual(await cmd.cronGet(c), [{ type: 0, delay: 30, mix: 0 }]);
  assert.ok(notes.length > 0);
  c.stop();
});
