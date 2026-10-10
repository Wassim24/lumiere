#!/usr/bin/env python3
"""Cloud-free control of Yeelight / Mi Wi-Fi bulbs.

Two local transports, both observed in com.yeelight.cherry 3.5.4:
  * miIO over UDP 54321, AES-128-CBC with key=MD5(token), iv=MD5(key+token)
    (libmiio.so AES_cbc_encrypt). Needs the bulb's 16-byte token.
  * Yeelight LAN text protocol over TCP 55443 (LanDevice). Needs
    "LAN control" enabled on the bulb (set_ps ["cfg_lan_ctrl","1"]).

Tokens are only handed out by a bulb that has not been provisioned yet,
so pair bulbs with this tool (after a factory reset) to keep their token.
"""

import argparse
import hashlib
import json
import os
import socket
import struct
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from cryptography.hazmat.primitives import padding
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

MIIO_PORT = 54321
LAN_PORT = 55443
HELLO = bytes.fromhex("21310020") + b"\xff" * 28
EMPTY_TOKENS = {b"\xff" * 16, b"\x00" * 16}
STATUS_PROPS = ["power", "bright", "ct", "rgb", "hue", "sat", "color_mode"]
COLOR_MODES = {1: "rgb", 2: "ct", 3: "hsv"}
STORE = Path(os.environ.get("YEELOCAL_STORE", Path.home() / ".config" / "yeelocal" / "bulbs.json"))


# ---------------------------------------------------------------- storage

def load_bulbs():
    try:
        return json.loads(STORE.read_text())
    except FileNotFoundError:
        return {}


def save_bulbs(bulbs):
    STORE.parent.mkdir(parents=True, exist_ok=True)
    STORE.write_text(json.dumps(bulbs, indent=2))
    STORE.chmod(0o600)  # tokens are secrets


# ---------------------------------------------------------------- miIO

def _md5(data):
    return hashlib.md5(data).digest()


def _cipher(token):
    key = _md5(token)
    return Cipher(algorithms.AES(key), modes.CBC(_md5(key + token)))


def encrypt(token, plaintext):
    padder = padding.PKCS7(128).padder()
    enc = _cipher(token).encryptor()
    return enc.update(padder.update(plaintext) + padder.finalize()) + enc.finalize()


def decrypt(token, ciphertext):
    dec = _cipher(token).decryptor()
    unpadder = padding.PKCS7(128).unpadder()
    data = unpadder.update(dec.update(ciphertext) + dec.finalize()) + unpadder.finalize()
    return data.rstrip(b"\x00")


def parse_hello(data):
    """Return (did, stamp, token-or-None) from a 32-byte hello reply."""
    if len(data) < 32 or data[:2] != b"\x21\x31":
        return None
    did = int.from_bytes(data[4:12], "big")  # same 8-byte read as the app
    stamp = struct.unpack(">I", data[12:16])[0]
    token = data[16:32]
    return did, stamp, None if token in EMPTY_TOKENS else token


def hello(ip, timeout=2.0, broadcast=False):
    """Send miIO hello; yield (ip, did, stamp, token) for every reply."""
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        if broadcast:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        s.settimeout(timeout)
        s.sendto(HELLO, (ip, MIIO_PORT))
        deadline = time.monotonic() + timeout
        while (left := deadline - time.monotonic()) > 0:
            s.settimeout(left)
            try:
                data, (addr, _) = s.recvfrom(4096)
            except socket.timeout:
                return
            parsed = parse_hello(data)
            if parsed:
                yield (addr, *parsed)
            if not broadcast:
                return


class MiioDevice:
    def __init__(self, ip, token, timeout=3.0):
        self.ip = ip
        self.token = bytes.fromhex(token) if isinstance(token, str) else token
        self.timeout = timeout
        self._id = int(time.time()) % 10000

    def send(self, method, params=None):
        replies = list(hello(self.ip, self.timeout))
        if not replies:
            raise TimeoutError(f"{self.ip}: no miIO hello reply")
        _, did, stamp, _ = replies[0]
        self._id += 1
        body = encrypt(self.token, json.dumps(
            {"id": self._id, "method": method, "params": params or []}).encode())
        header = struct.pack(">HHQI", 0x2131, 32 + len(body), did, stamp + 1)
        packet = header + _md5(header + self.token + body) + body
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.settimeout(self.timeout)
            s.sendto(packet, (self.ip, MIIO_PORT))
            try:
                data, _ = s.recvfrom(4096)
            except socket.timeout:
                raise TimeoutError(f"{self.ip}: no reply to {method} (wrong token?)") from None
        if _md5(data[:16] + self.token + data[32:]) != data[16:32]:
            raise ValueError("bad checksum: wrong token?")
        reply = json.loads(decrypt(self.token, data[32:]))
        if "error" in reply:
            raise RuntimeError(reply["error"])
        return reply.get("result")


# ---------------------------------------------------------------- LAN 55443

class LanDevice:
    def __init__(self, ip, timeout=3.0):
        self.ip = ip
        self.timeout = timeout
        self._id = 0

    def send(self, method, params=None):
        self._id += 1
        msg = json.dumps({"id": self._id, "method": method, "params": params or []})
        with socket.create_connection((self.ip, LAN_PORT), self.timeout) as s:
            s.sendall(msg.encode() + b"\r\n")
            buf = b""
            while True:
                chunk = s.recv(4096)
                if not chunk:
                    raise ConnectionError("connection closed")
                buf += chunk
                while b"\r\n" in buf:
                    line, buf = buf.split(b"\r\n", 1)
                    reply = json.loads(line)
                    if reply.get("id") != self._id:
                        continue  # unsolicited "props" notification
                    if "error" in reply:
                        raise RuntimeError(reply["error"])
                    return reply.get("result")


# ---------------------------------------------------------------- bulb API

class Bulb:
    """High-level commands; method names match the bulb's own (set_rgb, ...)."""

    def __init__(self, ip, token=None):
        self.dev = MiioDevice(ip, token) if token else LanDevice(ip)

    def _effect(self, smooth):
        return ["smooth", 500] if smooth else ["sudden", 0]

    def power(self, on, smooth=True):
        return self.dev.send("set_power", ["on" if on else "off", *self._effect(smooth)])

    def toggle(self):
        return self.dev.send("toggle")

    def brightness(self, level, smooth=True):
        return self.dev.send("set_bright", [max(1, min(100, int(level))), *self._effect(smooth)])

    def rgb(self, value, smooth=True):
        return self.dev.send("set_rgb", [int(value) & 0xFFFFFF, *self._effect(smooth)])

    def color_temp(self, kelvin, smooth=True):
        return self.dev.send("set_ct_abx", [max(1700, min(6500, int(kelvin))), *self._effect(smooth)])

    def hsv(self, hue, sat, smooth=True):
        return self.dev.send("set_hsv", [int(hue) % 360, max(0, min(100, int(sat))), *self._effect(smooth)])

    def lan_control(self, enabled):
        return self.dev.send("set_ps", ["cfg_lan_ctrl", "1" if enabled else "0"])

    def status(self):
        values = self.dev.send("get_prop", STATUS_PROPS)
        st = dict(zip(STATUS_PROPS, values))
        for key in ("bright", "ct", "rgb", "hue", "sat", "color_mode"):
            try:
                st[key] = int(st[key])
            except (KeyError, TypeError, ValueError):
                pass
        st["color_mode"] = COLOR_MODES.get(st.get("color_mode"), st.get("color_mode"))
        if isinstance(st.get("rgb"), int):
            st["hex"] = f"#{st['rgb']:06x}"
        return st


def get_bulb(name):
    bulbs = load_bulbs()
    if name not in bulbs:
        sys.exit(f"unknown bulb {name!r}; known: {', '.join(bulbs) or 'none'}")
    entry = bulbs[name]
    return Bulb(entry["ip"], entry.get("token"))


# ---------------------------------------------------------------- commands

def cmd_discover(args):
    bulbs = load_bulbs()
    by_did = {b.get("did"): name for name, b in bulbs.items()}
    found = list(hello(args.broadcast, args.timeout, broadcast=True))
    if not found and args.subnet:
        # some routers drop broadcasts: unicast a hello to every host of the /24
        from concurrent.futures import ThreadPoolExecutor
        prefix = args.subnet.rsplit(".", 1)[0]
        with ThreadPoolExecutor(64) as ex:
            for replies in ex.map(lambda i: list(hello(f"{prefix}.{i}", 1.5)), range(1, 255)):
                found += replies
    if not found:
        print("no miIO devices answered")
    for ip, did, _, token in found:
        name = by_did.get(did)
        if name and bulbs[name]["ip"] != ip:
            bulbs[name]["ip"] = ip
            print(f"{name}: IP updated to {ip}")
        token_note = f"token {token.hex()} (unprovisioned)" if token else "token hidden"
        print(f"{ip:15}  did {did:<12} {name or '(unknown)':<12} {token_note}")
    save_bulbs(bulbs)


def local_ip():
    """This machine's LAN address (no packet is sent by a UDP connect)."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))
            return s.getsockname()[0]
    except OSError:
        return None


def local_timezone():
    """IANA name such as Europe/Paris, as the app sends (TimeZone.getID())."""
    try:
        return str(Path("/etc/localtime").resolve()).split("zoneinfo/", 1)[1]
    except (OSError, IndexError):
        return "UTC"


def cmd_pair(args):
    target = args.ip or "255.255.255.255"
    replies = list(hello(target, 3.0, broadcast=not args.ip))
    if not replies:
        sys.exit("no bulb answered; are you connected to its yeelink-light-..._miap hotspot?")
    ip, did, _, token = replies[0]
    if token is None:
        sys.exit(f"bulb {ip} (did {did}) hides its token: it is already provisioned. Factory-reset it first.")
    bulbs = load_bulbs()
    bulbs[args.name] = {"ip": ip, "did": did, "token": token.hex()}
    save_bulbs(bulbs)
    print(f"saved {args.name}: did {did}, token {token.hex()}")
    params = {"ssid": args.ssid, "passwd": args.password, "uid": 0,
              "tz": args.tz or local_timezone()}
    dev = MiioDevice(ip, token)
    # the token may change once the bulb joins the home network, so also turn on
    # LAN control (TCP 55443, no token) while the token is known to work
    for method, call_params in (("miIO.info", []), ("set_ps", ["cfg_lan_ctrl", "1"])):
        try:
            print(f"{method} -> {json.dumps(dev.send(method, call_params))[:300]}")
        except (OSError, RuntimeError, ValueError) as e:
            print(f"{method} failed: {e}")
        else:
            if method == "set_ps":
                # observed on color3 fw 2.0.6: the token stops working after joining
                # the home network, so control it over LAN instead
                del bulbs[args.name]["token"]
                save_bulbs(bulbs)
    try:
        result = dev.send("miIO.config_router", params)
        print(f"config_router -> {result}")
    except TimeoutError:
        print("no reply to config_router (the bulb may already be switching networks)")
    print("Reconnect this machine to your home Wi-Fi, then run: yeelocal.py discover")


def cmd_add(args):
    bulbs = load_bulbs()
    entry = {"ip": args.ip}
    if args.token:
        entry["token"] = args.token.lower()
    replies = list(hello(args.ip, 2.0))
    if replies:
        entry["did"] = replies[0][1]
    bulbs[args.name] = entry
    save_bulbs(bulbs)
    print(f"saved {args.name}: {entry | ({'token': '***'} if args.token else {})}")


def cmd_list(_args):
    for name, b in load_bulbs().items():
        transport = "miio" if b.get("token") else "lan"
        print(f"{name:<15} {b['ip']:<15} did {b.get('did', '?'):<12} via {transport}")


def cmd_control(args):
    bulb = get_bulb(args.name)
    smooth = not args.sudden
    action = args.action
    if action == "on":
        result = bulb.power(True, smooth)
    elif action == "off":
        result = bulb.power(False, smooth)
    elif action == "toggle":
        result = bulb.toggle()
    elif action == "bright":
        result = bulb.brightness(args.value[0], smooth)
    elif action == "rgb":
        result = bulb.rgb(int(args.value[0].lstrip("#"), 16), smooth)
    elif action == "ct":
        result = bulb.color_temp(args.value[0], smooth)
    elif action == "hsv":
        result = bulb.hsv(args.value[0], args.value[1], smooth)
    elif action == "lan":
        result = bulb.lan_control(args.value[0] == "on")
    else:
        result = bulb.status()
    print(json.dumps(result, indent=2) if isinstance(result, dict) else result)


PAGE = """<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Bulbs</title>
<style>
:root{--bg:#f6f6f4;--card:#fff;--fg:#1d1d1b;--muted:#6b6b66;--line:#e2e2dd}
@media (prefers-color-scheme:dark){:root{--bg:#161615;--card:#21211f;--fg:#ecece8;--muted:#9a9a93;--line:#33332f}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.4 system-ui,sans-serif}
main{max-width:520px;margin:0 auto;padding:16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:12px}
.row{display:flex;align-items:center;gap:12px;margin-top:12px}.row label{width:90px;color:var(--muted)}
.row input[type=range]{flex:1}h2{margin:0;font-size:17px;display:flex;justify-content:space-between}
.err{color:#c0392b;font-size:13px;margin-top:8px}button{font:inherit;padding:6px 14px;border-radius:8px;
border:1px solid var(--line);background:var(--bg);color:var(--fg);cursor:pointer}
</style></head><body><main id="app">Loading…</main><script>
const api=(p,b)=>fetch(p,b?{method:"POST",body:JSON.stringify(b)}:{}).then(r=>r.json());
function card(name,s){const d=document.createElement("div");d.className="card";
const ok=!s.error;d.innerHTML=`<h2>${name}<button data-a="toggle">${ok&&s.power==="on"?"Turn off":"Turn on"}</button></h2>
${ok?`<div class="row"><label>Brightness</label><input type="range" min="1" max="100" value="${s.bright}" data-a="bright"></div>
<div class="row"><label>Color</label><input type="color" value="${s.hex||"#ffffff"}" data-a="rgb"></div>
<div class="row"><label>White</label><input type="range" min="1700" max="6500" step="100" value="${s.ct}" data-a="ct"></div>`
:`<div class="err">${s.error}</div>`}`;
d.querySelectorAll("[data-a]").forEach(el=>{const ev=el.tagName==="BUTTON"?"click":"change";
el.addEventListener(ev,async()=>{const r=await api("/api/"+encodeURIComponent(name),{action:el.dataset.a,value:el.value});
if(r.error)alert(r.error);load();});});return d;}
async function load(){const data=await api("/api/status");const app=document.getElementById("app");app.replaceChildren();
const names=Object.keys(data);if(!names.length)app.textContent="No bulbs saved yet. Use: yeelocal.py pair / add";
names.forEach(n=>app.appendChild(card(n,data[n])));}
load();
</script></body></html>"""


class Handler(BaseHTTPRequestHandler):
    def _json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/api/status":
            out = {}
            for name, b in load_bulbs().items():
                try:
                    out[name] = Bulb(b["ip"], b.get("token")).status()
                except Exception as e:  # report per-bulb failures to the page
                    out[name] = {"error": str(e)}
            return self._json(out)
        body = PAGE.encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        from urllib.parse import unquote
        name = unquote(self.path.removeprefix("/api/"))
        bulbs = load_bulbs()
        if name not in bulbs:
            return self._json({"error": "unknown bulb"}, 404)
        req = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        bulb = Bulb(bulbs[name]["ip"], bulbs[name].get("token"))
        try:
            action, value = req.get("action"), req.get("value")
            if action == "toggle":
                bulb.toggle()
            elif action == "bright":
                bulb.brightness(value)
            elif action == "rgb":
                bulb.rgb(int(str(value).lstrip("#"), 16))
            elif action == "ct":
                bulb.color_temp(value)
            else:
                return self._json({"error": f"unknown action {action}"}, 400)
            self._json({"ok": True})
        except Exception as e:
            self._json({"error": str(e)}, 502)

    def log_message(self, *_):
        pass


def cmd_serve(args):
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"serving on http://{args.host}:{args.port}")
    server.serve_forever()


def main():
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = p.add_subparsers(dest="cmd", required=True)

    d = sub.add_parser("discover", help="find miIO devices and refresh saved IPs")
    d.add_argument("--broadcast", default="255.255.255.255")
    d.add_argument("--timeout", type=float, default=3.0)
    d.add_argument("--subnet", default=local_ip(), help="sweep this /24 if broadcast finds nothing")
    d.set_defaults(func=cmd_discover)

    pr = sub.add_parser("pair", help="provision a factory-reset bulb (run while on its hotspot)")
    pr.add_argument("name")
    pr.add_argument("--ssid", required=True)
    pr.add_argument("--password", default=os.environ.get("YEELOCAL_WIFI_PASSWORD"),
                    help="default: $YEELOCAL_WIFI_PASSWORD")
    pr.add_argument("--ip", help="bulb IP on its hotspot (default: broadcast)")
    pr.add_argument("--tz", help="IANA timezone, e.g. Europe/Paris")
    pr.set_defaults(func=cmd_pair)

    a = sub.add_parser("add", help="save an already-connected bulb")
    a.add_argument("name")
    a.add_argument("--ip", required=True)
    a.add_argument("--token", help="32 hex chars; omit to use LAN control (port 55443)")
    a.set_defaults(func=cmd_add)

    sub.add_parser("list", help="list saved bulbs").set_defaults(func=cmd_list)

    c = sub.add_parser("set", help="control a bulb")
    c.add_argument("name")
    c.add_argument("action", choices=["on", "off", "toggle", "bright", "rgb", "ct", "hsv", "lan", "status"])
    c.add_argument("value", nargs="*")
    c.add_argument("--sudden", action="store_true", help="no fade")
    c.set_defaults(func=cmd_control)

    s = sub.add_parser("serve", help="local web UI")
    s.add_argument("--host", default="127.0.0.1")
    s.add_argument("--port", type=int, default=8080)
    s.set_defaults(func=cmd_serve)

    args = p.parse_args()
    try:
        args.func(args)
    except (OSError, RuntimeError, ValueError) as e:  # TimeoutError is an OSError
        sys.exit(f"error: {e}")


if __name__ == "__main__":
    main()
