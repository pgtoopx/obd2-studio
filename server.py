"""
Servidor Web OBD2 Studio (Python stdlib ThreadingHTTPServer)
Sirve la UI web interactiva y los endpoints REST JSON para control del Vgate iCar 2.
"""

import json
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

from obd_bridge import OBDBridge, connect_wifi_ssid, get_wifi_status
from pid_catalog import CATEGORIES, SENSOR_CATALOG

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
VIEWS_FILE = os.path.join(BASE_DIR, "custom_views.json")

bridge = OBDBridge()

DEFAULT_CUSTOM_VIEWS = [
    {
        "id": "cooling_bleed",
        "name": "Purgado Refrigerante & Térmico",
        "icon": "🌡️",
        "description": "Control estricto tras vaciar coolant y armar enfriador EGR",
        "widgets": [
            {"sensor_id": "0105", "type": "chart"},
            {"sensor_id": "0167", "type": "gauge"},
            {"sensor_id": "016B", "type": "chart"},
            {"sensor_id": "015C", "type": "gauge"},
            {"sensor_id": "011F", "type": "card"},
            {"sensor_id": "010C", "type": "card"},
        ],
    },
    {
        "id": "intake_leak",
        "name": "Hermeticidad Admisión & Turbo",
        "icon": "🌀",
        "description": "Verifica fugas en juntas, abrazaderas de intercooler y respuesta EGR/MAP",
        "widgets": [
            {"sensor_id": "010B", "type": "chart"},
            {"sensor_id": "0170_CMD", "type": "chart"},
            {"sensor_id": "0170_ACT", "type": "chart"},
            {"sensor_id": "0110", "type": "gauge"},
            {"sensor_id": "012D", "type": "gauge"},
            {"sensor_id": "012C", "type": "card"},
            {"sensor_id": "0177", "type": "card"},
            {"sensor_id": "010F", "type": "card"},
        ],
    },
]


def load_views():
    if os.path.exists(VIEWS_FILE):
        try:
            with open(VIEWS_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    save_views(DEFAULT_CUSTOM_VIEWS)
    return list(DEFAULT_CUSTOM_VIEWS)


def save_views(views):
    with open(VIEWS_FILE, "w", encoding="utf-8") as f:
        json.dump(views, f, ensure_ascii=False, indent=2)


class StudioHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=STATIC_DIR, **kwargs)

    def log_message(self, format, *args):
        pass  # Silenciar logs HTTP ruidosos por cada poll

    def _send_json(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8"))

    def do_GET(self):
        path = urlparse(self.path).path

        if path == "/" or path == "/index.html":
            self.path = "/index.html"
            return super().do_GET()

        if path == "/api/status":
            return self._send_json({
                "obd": bridge.get_status(),
                "wifi": get_wifi_status(),
            })

        if path == "/api/wifi":
            return self._send_json(get_wifi_status())

        if path == "/api/pids":
            sensors = []
            for s in SENSOR_CATALOG:
                sensors.append({
                    "id": s["id"],
                    "pid": s["pid"],
                    "name": s["name"],
                    "short": s["short"],
                    "unit": s["unit"],
                    "category": s["category"],
                    "min": s.get("min", 0),
                    "max": s.get("max", 100),
                    "warn_low": s.get("warn_low"),
                    "crit_low": s.get("crit_low"),
                    "warn_high": s.get("warn_high"),
                    "crit_high": s.get("crit_high"),
                    "description": s["description"],
                    "supported": s["id"] in bridge.supported_ids,
                })
            return self._send_json({
                "categories": CATEGORIES,
                "sensors": sensors,
                "supported_ids": bridge.supported_ids,
            })

        if path == "/api/telemetry":
            return self._send_json(bridge.get_telemetry_snapshot())

        if path == "/api/scan-all":
            ok, data = bridge.scan_all_sensors()
            return self._send_json({"ok": ok, "data": data})

        if path == "/api/dtcs":
            return self._send_json(bridge.read_dtcs_and_freeze_frame())

        if path == "/api/views":
            return self._send_json({"views": load_views()})

        return super().do_GET()

    def do_POST(self):
        path = urlparse(self.path).path
        try:
            body = self._read_json()
        except Exception:
            return self._send_json({"ok": False, "error": "JSON inválido"}, 400)

        if path == "/api/wifi/connect":
            ssid = body.get("ssid", "V-LINK")
            ok, msg = connect_wifi_ssid(ssid)
            return self._send_json({"ok": ok, "message": msg, "wifi": get_wifi_status()})

        if path == "/api/connect":
            ip = body.get("ip", "192.168.0.10")
            port = int(body.get("port", 35000))
            mode = body.get("mode", "live")
            ok, msg = bridge.connect(ip=ip, port=port, mode=mode)
            return self._send_json({"ok": ok, "message": msg, "obd": bridge.get_status()})

        if path == "/api/disconnect":
            bridge.disconnect()
            return self._send_json({"ok": True, "obd": bridge.get_status()})

        if path == "/api/watch":
            ids = body.get("ids", [])
            bridge.set_watch_ids(ids)
            return self._send_json({"ok": True, "watch_ids": bridge.watch_ids})

        if path == "/api/dtcs/clear":
            force = bool(body.get("force", False))
            return self._send_json(bridge.clear_dtcs(force=force))

        if path == "/api/views":
            views = body.get("views")
            if not isinstance(views, list):
                return self._send_json({"ok": False, "error": "views debe ser una lista"}, 400)
            save_views(views)
            return self._send_json({"ok": True, "views": views})

        if path == "/api/log/start":
            p = bridge.start_log()
            return self._send_json({"ok": True, "file": os.path.basename(p)})

        if path == "/api/log/stop":
            p = bridge.stop_log()
            return self._send_json({"ok": True, "file": os.path.basename(p) if p else None})

        return self._send_json({"ok": False, "error": "Endpoint no encontrado"}, 404)


if __name__ == "__main__":
    port = int(os.environ.get("OBD_WEB_PORT", "8080"))
    server = ThreadingHTTPServer(("0.0.0.0", port), StudioHandler)
    print(f"OBD2 Studio Server corriendo en http://127.0.0.1:{port}", flush=True)
    server.serve_forever()
