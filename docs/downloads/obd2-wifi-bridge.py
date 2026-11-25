#!/usr/bin/env python3
"""
OBD2 Studio — Standalone Wi-Fi Bridge (Windows & Linux)
Single-file, zero-dependency HTTP-to-TCP relay for ELM327 Wi-Fi adapters (e.g. Vgate iCar 2).
Allows the static web app (GitHub Pages or offline PWA) to talk to 192.168.0.10:35000.

Usage:
  Windows: python obd2-wifi-bridge.py
  Linux:   python3 obd2-wifi-bridge.py
"""

import json
import os
import platform
import shutil
import socket
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse


def get_wifi_status():
    info = {"connected": False, "ssid": None, "signal": None, "vlink_visible": False, "os": platform.system()}
    sys_name = platform.system().lower()
    if sys_name == "windows":
        try:
            out = subprocess.check_output(["netsh", "wlan", "show", "interfaces"], text=True, errors="replace", timeout=4)
            for line in out.splitlines():
                if ":" not in line:
                    continue
                k, v = [p.strip() for p in line.split(":", 1)]
                kl = k.lower()
                if kl in ("estado", "state"):
                    info["connected"] = "conectado" in v.lower() or v.lower() == "connected"
                elif kl == "ssid":
                    info["ssid"] = v
                elif "señal" in kl or "signal" in kl:
                    info["signal"] = v
            nets = subprocess.check_output(["netsh", "wlan", "show", "networks"], text=True, errors="replace", timeout=4)
            info["vlink_visible"] = "V-LINK" in nets.upper()
        except Exception:
            pass
    elif sys_name == "linux" and shutil.which("nmcli"):
        try:
            out = subprocess.check_output(["nmcli", "-t", "-f", "ACTIVE,SSID,SIGNAL", "dev", "wifi"], text=True, errors="replace", timeout=5)
            for line in out.splitlines():
                parts = line.split(":")
                if len(parts) >= 3:
                    active, ssid, sig = parts[0], parts[1], parts[2]
                    if ssid.upper() == "V-LINK":
                        info["vlink_visible"] = True
                    if active in ("yes", "sí", "*"):
                        info["connected"] = True
                        info["ssid"] = ssid
                        info["signal"] = f"{sig}%"
        except Exception:
            pass
    return info


def connect_wifi(ssid="V-LINK"):
    sys_name = platform.system().lower()
    try:
        if sys_name == "windows":
            out = subprocess.check_output(["netsh", "wlan", "connect", f"name={ssid}"], text=True, errors="replace", timeout=6)
            time.sleep(2.0)
            return True, out.strip()
        if sys_name == "linux" and shutil.which("nmcli"):
            out = subprocess.check_output(["nmcli", "dev", "wifi", "connect", ssid], text=True, errors="replace", timeout=10)
            return True, out.strip()
        return False, f"Manual Wi-Fi connection required on {platform.system()}."
    except Exception as e:
        return False, str(e)


class ELMRelay:
    def __init__(self):
        self.lock = threading.RLock()
        self.sock = None
        self.mode = "disconnected"
        self.ip = "192.168.0.10"
        self.port = 35000
        self.adapter_version = None
        self.battery_voltage = None

    def _raw_cmd(self, cmd, delay=0.06):
        if not self.sock:
            raise RuntimeError("Socket not connected")
        self.sock.sendall((cmd + "\r").encode("ascii"))
        time.sleep(delay)
        raw = b""
        deadline = time.time() + 2.5
        while time.time() < deadline:
            try:
                chunk = self.sock.recv(1024)
                if not chunk:
                    break
                raw += chunk
                if b">" in chunk:
                    break
            except socket.timeout:
                break
        res = raw.decode("ascii", errors="replace").strip().replace(">", "").strip()
        return " ".join(ln.strip() for ln in res.splitlines() if ln.strip())

    def connect(self, ip="192.168.0.10", port=35000):
        with self.lock:
            self.disconnect()
            self.ip = ip
            self.port = int(port)
            try:
                s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                s.settimeout(3.5)
                s.connect((self.ip, self.port))
                self.sock = s
                atz = self._raw_cmd("ATZ", delay=0.4)
                self._raw_cmd("ATE0", delay=0.1)
                self._raw_cmd("ATL0", delay=0.1)
                self._raw_cmd("ATSP0", delay=0.15)
                self._raw_cmd("ATST32", delay=0.1)
                atrv = self._raw_cmd("ATRV", delay=0.12)
                try:
                    self.battery_voltage = float(atrv.replace("V", "").strip())
                except Exception:
                    self.battery_voltage = None
                self.adapter_version = atz.replace("ATZ", "").strip() or "ELM327 Wi-Fi"
                self.mode = "relay"
                return True, f"Connected to {self.adapter_version} ({self.ip}:{self.port})"
            except Exception as e:
                self.disconnect()
                return False, f"Failed to connect to {self.ip}:{self.port}: {e}"

    def disconnect(self):
        with self.lock:
            if self.sock:
                try:
                    self.sock.close()
                except Exception:
                    pass
                self.sock = None
            self.mode = "disconnected"

    def send_raw(self, cmd, delay=0.07):
        with self.lock:
            if not self.sock:
                return {"ok": False, "error": "Not connected", "raw": ""}
            try:
                return {"ok": True, "cmd": cmd, "raw": self._raw_cmd(cmd, delay=delay)}
            except Exception as e:
                return {"ok": False, "error": str(e), "raw": ""}

    def send_batch(self, cmds, delay=0.05):
        with self.lock:
            if not self.sock:
                return {"ok": False, "error": "Not connected", "results": {}}
            results = {}
            try:
                for c in cmds:
                    results[c] = self._raw_cmd(c.strip(), delay=delay)
                return {"ok": True, "results": results}
            except Exception as e:
                return {"ok": False, "error": str(e), "results": results}


relay = ELMRelay()


class BridgeHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def _json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        n = int(self.headers.get("Content-Length", "0"))
        return json.loads(self.rfile.read(n).decode("utf-8")) if n > 0 else {}

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/" or path == "/api/status":
            return self._json({
                "obd": {
                    "mode": relay.mode,
                    "ip": relay.ip,
                    "port": relay.port,
                    "adapter_version": relay.adapter_version,
                    "battery_voltage": relay.battery_voltage,
                },
                "wifi": get_wifi_status(),
            })
        return self._json({"ok": False, "error": "Not found"}, 404)

    def do_POST(self):
        path = urlparse(self.path).path
        b = self._body()
        if path == "/api/wifi/connect":
            ok, msg = connect_wifi(b.get("ssid", "V-LINK"))
            return self._json({"ok": ok, "message": msg, "wifi": get_wifi_status()})
        if path == "/api/connect":
            ok, msg = relay.connect(b.get("ip", "192.168.0.10"), b.get("port", 35000))
            return self._json({"ok": ok, "message": msg, "obd": {"mode": relay.mode, "adapter_version": relay.adapter_version, "battery_voltage": relay.battery_voltage}})
        if path == "/api/disconnect":
            relay.disconnect()
            return self._json({"ok": True})
        if path == "/api/raw":
            return self._json(relay.send_raw(b.get("cmd", ""), float(b.get("delay", 0.07))))
        if path == "/api/batch":
            return self._json(relay.send_batch(b.get("cmds", []), float(b.get("delay", 0.05))))
        return self._json({"ok": False, "error": "Not found"}, 404)


if __name__ == "__main__":
    if platform.system().lower() == "windows":
        ThreadingHTTPServer.allow_reuse_address = False
    port = int(os.environ.get("OBD_WEB_PORT", "8080"))
    print("=" * 60)
    print(f"  OBD2 Studio Wi-Fi Bridge running on http://127.0.0.1:{port}")
    print("  Open https://pgtoopx.github.io/obd2-studio/ and click 'Wi-Fi Bridge'")
    print("  Press Ctrl+C to stop.")
    print("=" * 60, flush=True)
    ThreadingHTTPServer(("127.0.0.1", port), BridgeHandler).serve_forever()
