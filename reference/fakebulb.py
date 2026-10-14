"""Fake Yeelight bulb: miIO on UDP 54321 and LAN text protocol on TCP 55443 (localhost)."""
import hashlib, json, os, socket, struct, sys, threading
from cryptography.hazmat.primitives import padding
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

TOKEN = bytes.fromhex("00112233445566778899aabbccddeeff")
DID = 123456789
HOST = os.environ.get("FAKEBULB_HOST", "127.0.0.1")  # 0.0.0.0 to reach it from an emulator (10.0.2.2)
PROVISIONED = "--provisioned" in sys.argv
state = {"power": "off", "bright": "50", "ct": "4000", "rgb": "16777215", "hue": "0", "sat": "0", "color_mode": "2", "delayoff": "0", "flowing": "0"}
log = []

def md5(b): return hashlib.md5(b).digest()
def cipher():
    k = md5(TOKEN); return Cipher(algorithms.AES(k), modes.CBC(md5(k + TOKEN)))

def handle(req):
    m, p = req["method"], req["params"]
    log.append((m, p))
    if m == "set_power": state["power"] = p[0]
    elif m == "set_bright": state["bright"] = str(p[0])
    elif m == "set_rgb": state.update(rgb=str(p[0]), color_mode="1")
    elif m == "set_ct_abx": state.update(ct=str(p[0]), color_mode="2")
    elif m == "set_hsv": state.update(hue=str(p[0]), sat=str(p[1]), color_mode="3")
    elif m == "toggle": state["power"] = "off" if state["power"] == "on" else "on"
    elif m == "get_prop": return [state.get(k, "") for k in p]
    elif m == "set_scene" and p[0] == "ct": state.update(power="on", ct=str(p[1]), bright=str(p[2]), color_mode="2")
    elif m == "set_scene" and p[0] == "color": state.update(power="on", rgb=str(p[1]), bright=str(p[2]), color_mode="1")
    elif m == "cron_add": state["delayoff"] = str(p[1])
    elif m == "cron_get": return [{"type": 0, "delay": int(state.get("delayoff", 0)), "mix": 0}] if state.get("delayoff", "0") != "0" else []
    elif m == "cron_del": state["delayoff"] = "0"
    elif m in ("set_ps", "miIO.config_router", "start_cf", "stop_cf"): pass
    else: return {"error": {"code": -1, "message": "method not supported"}}
    return ["ok"]

def udp():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.bind((HOST, 54321))
    while True:
        data, addr = s.recvfrom(4096)
        if len(data) == 32:  # hello
            tok = b"\xff" * 16 if PROVISIONED else TOKEN
            s.sendto(struct.pack(">HHQI", 0x2131, 32, DID, 1000) + tok, addr); continue
        assert md5(data[:16] + TOKEN + data[32:]) == data[16:32], "checksum"
        d = cipher().decryptor(); u = padding.PKCS7(128).unpadder()
        req = json.loads(u.update(d.update(data[32:]) + d.finalize()) + u.finalize())
        res = handle(req)
        reply = {"id": req["id"], **(res if isinstance(res, dict) else {"result": res})}
        pd = padding.PKCS7(128).padder(); e = cipher().encryptor()
        body = e.update(pd.update(json.dumps(reply).encode()) + pd.finalize()) + e.finalize()
        hdr = struct.pack(">HHQI", 0x2131, 32 + len(body), DID, 1001)
        s.sendto(hdr + md5(hdr + TOKEN + body) + body, addr)

def tcp():
    srv = socket.socket(); srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind((HOST, 55443)); srv.listen()
    while True:
        c, _ = srv.accept()
        req = json.loads(c.recv(4096).split(b"\r\n")[0])
        c.sendall(b'{"method":"props","params":{"power":"on"}}\r\n')  # unsolicited notification first
        res = handle(req)
        c.sendall(json.dumps({"id": req["id"], **(res if isinstance(res, dict) else {"result": res})}).encode() + b"\r\n")
        c.close()

threading.Thread(target=udp, daemon=True).start()
threading.Thread(target=tcp, daemon=True).start()
threading.Event().wait()
