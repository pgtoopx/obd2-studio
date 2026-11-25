"""
Puente OBD-II Wi-Fi (ELM327 TCP Socket) + Simulador Demo + Logger CSV.
Thread-safe para backend web en tiempo real.
"""

import csv
import math
import os
import platform
import shutil
import socket
import subprocess
import threading
import time
from collections import deque
from datetime import datetime

from pid_catalog import (
    CATALOG_BY_ID,
    MUSSO_DEFAULT_SUPPORTED,
    SENSOR_CATALOG,
    decode_dtc_pair,
    describe_dtc,
    extract_data_bytes,
    parse_bitmask_pids,
)

LOGS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "logs")


def get_wifi_status():
    """Consulta estado actual de Wi-Fi en Windows (netsh) o Linux (nmcli/iwgetid)."""
    info = {
        "connected": False,
        "ssid": None,
        "signal": None,
        "ip": None,
        "vlink_visible": False,
        "networks": [],
        "os": platform.system(),
    }
    sys_name = platform.system().lower()

    if sys_name == "windows":
        try:
            out = subprocess.check_output(
                ["netsh", "wlan", "show", "interfaces"],
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=4,
            )
            for line in out.splitlines():
                if ":" not in line:
                    continue
                k, v = [p.strip() for p in line.split(":", 1)]
                k_low = k.lower()
                if k_low in ("estado", "state"):
                    info["connected"] = "conectado" in v.lower() or v.lower() == "connected"
                elif k_low == "ssid":
                    info["ssid"] = v
                elif "señal" in k_low or "signal" in k_low:
                    info["signal"] = v
        except Exception:
            pass

        try:
            out_net = subprocess.check_output(
                ["netsh", "wlan", "show", "networks"],
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=4,
            )
            for line in out_net.splitlines():
                if line.strip().startswith("SSID") and ":" in line:
                    ssid = line.split(":", 1)[1].strip()
                    if ssid:
                        info["networks"].append(ssid)
                        if ssid.upper() == "V-LINK":
                            info["vlink_visible"] = True
        except Exception:
            pass

    elif sys_name == "linux":
        if shutil.which("nmcli"):
            try:
                out = subprocess.check_output(
                    ["nmcli", "-t", "-f", "ACTIVE,SSID,SIGNAL", "dev", "wifi"],
                    stderr=subprocess.STDOUT,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    timeout=5,
                )
                for line in out.splitlines():
                    parts = line.split(":")
                    if len(parts) >= 3:
                        active, ssid, signal = parts[0], parts[1], parts[2]
                        if ssid:
                            info["networks"].append(ssid)
                            if ssid.upper() == "V-LINK":
                                info["vlink_visible"] = True
                        if active in ("yes", "sí", "*"):
                            info["connected"] = True
                            info["ssid"] = ssid
                            info["signal"] = f"{signal}%"
            except Exception:
                pass
        elif shutil.which("iwgetid"):
            try:
                ssid = subprocess.check_output(["iwgetid", "-r"], text=True, timeout=3).strip()
                if ssid:
                    info["connected"] = True
                    info["ssid"] = ssid
            except Exception:
                pass

    return info


def connect_wifi_ssid(ssid="V-LINK"):
    """Conecta la interfaz Wi-Fi al SSID especificado en Windows o Linux."""
    sys_name = platform.system().lower()
    try:
        if sys_name == "windows":
            out = subprocess.check_output(
                ["netsh", "wlan", "connect", f"name={ssid}"],
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=6,
            )
            time.sleep(2.0)
            return True, out.strip()
        if sys_name == "linux":
            if not shutil.which("nmcli"):
                return False, "nmcli no está instalado. Conéctate manualmente a la red Wi-Fi V-LINK."
            out = subprocess.check_output(
                ["nmcli", "dev", "wifi", "connect", ssid],
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=10,
            )
            return True, out.strip()
        return False, f"Conexión Wi-Fi automática no implementada en {platform.system()}."
    except subprocess.CalledProcessError as e:
        return False, e.output.strip() if e.output else str(e)
    except Exception as e:
        return False, str(e)


class OBDBridge:
    def __init__(self):
        self.lock = threading.RLock()
        self.mode = "disconnected"  # disconnected | live | demo
        self.ip = "192.168.0.10"
        self.port = 35000
        self.sock = None

        self.adapter_version = None
        self.protocol = None
        self.battery_voltage = None
        self.last_error = None
        self.connected_at = None

        # PIDs descubiertos y lista activa en observación
        self.supported_ids = list(MUSSO_DEFAULT_SUPPORTED)
        self.watch_ids = [
            "0105", "0167", "015C", "016B", "010F", "0177",
            "010B", "0133", "0170_CMD", "0170_ACT", "0171",
            "0110", "012C", "012D", "010C", "0123", "0149",
            "ATRV", "0142", "012F", "011F", "017A"
        ]

        # Últimas lecturas y buffer histórico (últimos 180 puntos por sensor)
        self.latest = {}
        self.history = {}
        self.last_poll_ms = 0
        self.poll_count = 0

        # Estado de grabación CSV
        self.logging = False
        self.log_path = None
        self._log_file = None
        self._log_writer = None

        # Hilo de polling continuo
        self._stop_event = threading.Event()
        self._thread = None
        self._demo_start = time.time()

    def _raw_cmd(self, cmd, delay=0.05):
        if not self.sock:
            raise RuntimeError("Socket OBD no conectado")
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
        lines = [ln.strip() for ln in res.splitlines() if ln.strip()]
        return " ".join(lines)

    def connect(self, ip="192.168.0.10", port=35000, mode="live"):
        with self.lock:
            self.disconnect()
            self.ip = ip
            self.port = int(port)
            self.last_error = None

            if mode == "demo":
                self.mode = "demo"
                self.adapter_version = "ELM327 v2.1 (Simulador Musso 2.2)"
                self.protocol = "ISO 15765-4 CAN (11 bit, 500 kbaud)"
                self.battery_voltage = 14.2
                self.supported_ids = list(MUSSO_DEFAULT_SUPPORTED)
                self.connected_at = time.time()
                self._demo_start = time.time()
                self._start_poller()
                return True, "Modo Simulación Demo iniciado con perfil SsangYong Musso 2022"

            try:
                s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                s.settimeout(3.5)
                s.connect((self.ip, self.port))
                self.sock = s

                atz = self._raw_cmd("ATZ", delay=0.4)
                self._raw_cmd("ATE0", delay=0.1)
                self._raw_cmd("ATL0", delay=0.1)
                self._raw_cmd("ATSP6", delay=0.15)
                self._raw_cmd("ATST32", delay=0.1)  # Timeout adaptativo 200ms para respuestas rápidas

                atrv = self._raw_cmd("ATRV", delay=0.15)
                try:
                    self.battery_voltage = float(atrv.replace("V", "").strip())
                except Exception:
                    self.battery_voltage = None

                self.adapter_version = atz.replace("ATZ", "").strip() or "ELM327 Wi-Fi"
                self.protocol = "ISO 15765-4 CAN (500 kbps)"
                self.mode = mode if mode in ("live", "relay") else "live"
                self.connected_at = time.time()

                if self.mode == "live":
                    # Descubrir PIDs reales soportados por el vehículo y arrancar poller interno
                    self._discover_supported_pids()
                    self._start_poller()
                return True, f"Conectado a {self.adapter_version} ({self.ip}:{self.port})"
            except Exception as e:
                if self.sock:
                    try:
                        self.sock.close()
                    except Exception:
                        pass
                self.sock = None
                self.mode = "disconnected"
                self.last_error = str(e)
                return False, f"Error conectando a {self.ip}:{self.port}: {e}"

    def _discover_supported_pids(self):
        """Consulta 0100, 0120, 0140, 0160, 0180 para detectar todos los sensores del vehículo."""
        discovered_raw_pids = set()
        bases = [("0100", 0x00), ("0120", 0x20), ("0140", 0x40), ("0160", 0x60), ("0180", 0x80)]
        for cmd_hex, base_num in bases:
            resp = self._raw_cmd(cmd_hex, delay=0.12)
            data = extract_data_bytes(resp, "41", cmd_hex[2:])
            if len(data) >= 4:
                for p in parse_bitmask_pids(base_num, data):
                    discovered_raw_pids.add(p)
                # Si el bit 0x20 (siguiente rango) no está activo, igual probamos por seguridad
            else:
                break

        if discovered_raw_pids:
            # Mapear al catálogo (si un PID físico está soportado, incluir todos sus sensores derivados)
            matched = []
            for item in SENSOR_CATALOG:
                if item["pid"] == "ATRV" or item["pid"] in discovered_raw_pids:
                    matched.append(item["id"])
            if matched:
                self.supported_ids = matched

    def disconnect(self):
        self._stop_poller()
        self.stop_log()
        with self.lock:
            if self.sock:
                try:
                    self.sock.close()
                except Exception:
                    pass
                self.sock = None
            self.mode = "disconnected"
            self.connected_at = None

    def _start_poller(self):
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._poll_loop, daemon=True)
        self._thread.start()

    def _stop_poller(self):
        self._stop_event.set()
        if self.sock:
            try:
                self.sock.shutdown(socket.SHUT_RDWR)
            except Exception:
                pass
            try:
                self.sock.close()
            except Exception:
                pass
            self.sock = None
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=1.5)
        self._thread = None

    def set_watch_ids(self, ids):
        with self.lock:
            valid = [i for i in ids if i in CATALOG_BY_ID]
            if valid:
                self.watch_ids = valid

    def _record_value(self, sensor_id, val, raw_hex=""):
        ts = time.time()
        ts_str = datetime.fromtimestamp(ts).strftime("%H:%M:%S")
        entry = {
            "id": sensor_id,
            "value": val,
            "raw": raw_hex,
            "ts": ts,
            "time": ts_str,
        }
        self.latest[sensor_id] = entry
        if sensor_id not in self.history:
            self.history[sensor_id] = deque(maxlen=180)
        self.history[sensor_id].append({"t": ts_str, "v": val})

    def _poll_once_live(self, target_ids):
        """Agrupa por PID físico para consultar una sola vez cada comando OBD."""
        pid_groups = {}
        for sid in target_ids:
            meta = CATALOG_BY_ID.get(sid)
            if not meta:
                continue
            pid = meta["pid"]
            pid_groups.setdefault(pid, []).append(meta)

        for pid, metas in pid_groups.items():
            if self._stop_event.is_set() or not self.sock:
                break
            if pid == "ATRV":
                with self.lock:
                    if not self.sock:
                        break
                    raw = self._raw_cmd("ATRV", delay=0.06)
                try:
                    val = round(float(raw.replace("V", "").strip()), 2)
                    self.battery_voltage = val
                    with self.lock:
                        for m in metas:
                            self._record_value(m["id"], val, raw)
                except Exception:
                    pass
                continue

            with self.lock:
                if not self.sock:
                    break
                raw = self._raw_cmd(pid, delay=0.06)
            data = extract_data_bytes(raw, "41", pid[2:])
            if not data:
                continue
            with self.lock:
                for m in metas:
                    if len(data) >= m["min_bytes"] and m["decoder"]:
                        try:
                            val = m["decoder"](data)
                            if val is not None:
                                self._record_value(m["id"], val, " ".join(data))
                        except Exception:
                            pass

    def _poll_once_demo(self, target_ids):
        """Genera telemetría realista de SsangYong Musso 2.2 calentando tras rearmado."""
        elapsed = time.time() - self._demo_start
        # Simular calentamiento gradual del coolant desde 42°C hasta 87°C (apertura termostato)
        coolant = min(87.5, 42.0 + elapsed * 0.45) + math.sin(elapsed * 0.2) * 0.4
        # Simular aceleraciones suaves periódicas cada 18s
        wave = max(0.0, math.sin(elapsed * 0.35))
        is_rev = wave > 0.65
        rev_factor = ((wave - 0.65) / 0.35) if is_rev else 0.0

        rpm = round(780 + rev_factor * 1750 + math.sin(elapsed * 3) * 8)
        pedal = round(18.8 + rev_factor * 24.0, 1)
        baro = 100
        cmd_kpa = round(109.0 + rev_factor * 48.0, 1)
        act_kpa = round(102.0 + rev_factor * 42.0, 1)
        map_kpa = round(act_kpa)
        maf = round(8.5 + rev_factor * 36.0, 2)
        rail = round(265.0 + rev_factor * 490.0, 1)

        sim_values = {
            "0105": round(coolant, 1),
            "0167": round(coolant - 0.5, 1),
            "015C": round(min(84.0, 38.0 + elapsed * 0.35), 1),
            "016B": round(78.0 + rev_factor * 65.0, 1),
            "010F": round(27.0 + math.sin(elapsed * 0.1) * 1.2, 1),
            "0168": round(29.0 + rev_factor * 4.0, 1),
            "0177": round(31.0 + rev_factor * 9.0, 1),
            "0175": round(165.0 + rev_factor * 120.0, 1),
            "0146": 21,
            "010B": map_kpa,
            "0133": baro,
            "0170_CMD": cmd_kpa,
            "0170_ACT": act_kpa,
            "0171": round(72.0 - rev_factor * 35.0, 1),
            "0110": maf,
            "012C": round(35.0 * (1 - rev_factor), 1),
            "012D": round(math.sin(elapsed * 0.5) * 1.8, 1),
            "0111": round(84.0 + rev_factor * 15.0, 1),
            "014C": round(84.0 + rev_factor * 15.0, 1),
            "ATRV": 14.2,
            "0142": 14.15,
            "012F": 64.5,
            "011F": round(elapsed + 120),
            "0121": 0,
            "0131": 12,
            "010C": rpm,
            "010D": 0,
            "0104": round(17.5 + rev_factor * 32.0, 1),
            "0149": pedal,
            "0123": rail,
            "015E": round(0.9 + rev_factor * 4.2, 2),
            "0162": round(12 + rev_factor * 35),
            "0163": 420,
            "017A": round(10.8 + rev_factor * 14.0, 1),
            "017C_IN": round(105.0 + rev_factor * 90.0, 1),
            "017C_OUT": round(92.0 + rev_factor * 72.0, 1),
            "018C": 33.2,
            "0178": round(140.0 + rev_factor * 110.0, 1),
        }

        for sid in target_ids:
            if sid in sim_values:
                self._record_value(sid, sim_values[sid], "SIM")

    def _poll_loop(self):
        while not self._stop_event.is_set():
            t0 = time.time()
            try:
                with self.lock:
                    targets = list(self.watch_ids)
                    current_mode = self.mode

                if current_mode == "live":
                    self._poll_once_live(targets)
                elif current_mode == "demo":
                    with self.lock:
                        self._poll_once_demo(targets)
                else:
                    break

                self.last_poll_ms = round((time.time() - t0) * 1000)
                self.poll_count += 1

                if self.logging:
                    self._write_log_row()

            except Exception as e:
                with self.lock:
                    self.last_error = f"Error de lectura OBD: {e}"
                    if "10054" in str(e) or "10053" in str(e) or "timed out" in str(e).lower():
                        # Conexión perdida por auto-sleep o apagado
                        self.mode = "disconnected"
                        break
            time.sleep(0.12)

    def scan_all_sensors(self):
        """Realiza un barrido único de TODOS los sensores soportados."""
        with self.lock:
            if self.mode == "disconnected":
                return False, "No hay conexión activa"
            targets = list(self.supported_ids)
            if self.mode == "live":
                self._poll_once_live(targets)
            elif self.mode == "demo":
                self._poll_once_demo(targets)
            return True, self.get_telemetry_snapshot()

    def read_dtcs_and_freeze_frame(self):
        """Lee estado MIL, monitores de disponibilidad, DTCs (03, 07, 0A) y Freeze Frame (02)."""
        with self.lock:
            if self.mode == "disconnected":
                return {"ok": False, "error": "Desconectado"}

            if self.mode == "demo":
                return {
                    "ok": True,
                    "mil_on": False,
                    "dtc_count": 0,
                    "confirmed": [],
                    "pending": [],
                    "permanent": [],
                    "monitors": {
                        "misfire": "OK",
                        "fuel_system": "OK",
                        "components": "OK",
                        "egr_system": "OK",
                        "dpf_system": "OK",
                        "boost_control": "OK",
                    },
                    "freeze_frame": None,
                    "note": "Modo Demo: sin códigos de falla tras armado de admisión.",
                }

            # Lectura real por socket
            raw_0101 = self._raw_cmd("0101", delay=0.12)
            b_0101 = extract_data_bytes(raw_0101, "41", "01")
            mil_on = False
            dtc_count = 0
            monitors = {}
            if len(b_0101) >= 4:
                byte_a = int(b_0101[0], 16)
                mil_on = bool(byte_a & 0x80)
                dtc_count = byte_a & 0x7F
                byte_b = int(b_0101[1], 16)
                byte_c = int(b_0101[2], 16)
                byte_d = int(b_0101[3], 16)
                # Monitores de compresión (diésel bit 3 de byte B = 1)
                monitors = {
                    "misfire": "OK" if not (byte_b & 0x10) else "Pendiente",
                    "fuel_system": "OK" if not (byte_b & 0x20) else "Pendiente",
                    "components": "OK" if not (byte_b & 0x40) else "Pendiente",
                    "egr_vvt": "OK" if not (byte_d & 0x80) else "Pendiente",
                    "dpf_pm": "OK" if not (byte_d & 0x40) else "Pendiente",
                    "boost_control": "OK" if not (byte_d & 0x08) else "Pendiente",
                }

            def parse_dtc_mode(cmd_hex, resp_mode_hex):
                raw = self._raw_cmd(cmd_hex, delay=0.15)
                if not raw or "NO DATA" in raw:
                    return []
                tokens = [t.upper() for t in raw.replace(":", " ").replace("\n", " ").split() if len(t) == 2]
                # Buscar byte resp_mode_hex (43, 47, 4A)
                codes = []
                if resp_mode_hex in tokens:
                    idx = tokens.index(resp_mode_hex)
                    payload = tokens[idx + 1:]
                    # En ISO 15765 CAN, el primer byte después de 43/47/4A suele ser el conteo si longitud es impar
                    if len(payload) % 2 != 0 and len(payload) >= 1:
                        payload = payload[1:]
                    for i in range(0, len(payload) - 1, 2):
                        c = decode_dtc_pair(payload[i], payload[i + 1])
                        if c:
                            codes.append({"code": c, "description": describe_dtc(c)})
                return codes

            confirmed = parse_dtc_mode("03", "43")
            pending = parse_dtc_mode("07", "47")
            permanent = parse_dtc_mode("0A", "4A")

            # Freeze Frame (Modo 02)
            ff = None
            raw_ff_dtc = self._raw_cmd("020200", delay=0.12)
            ff_bytes = extract_data_bytes(raw_ff_dtc, "42", "02")
            if len(ff_bytes) >= 3:
                ff_code = decode_dtc_pair(ff_bytes[1], ff_bytes[2])
                if ff_code:
                    ff = {"dtc": ff_code, "description": describe_dtc(ff_code), "params": {}}
                    ff_queries = [
                        ("020C00", "0C", "RPM", lambda d: f"{round((int(d[1],16)*256+int(d[2],16))/4)} RPM" if len(d)>=3 else None),
                        ("020D00", "0D", "Velocidad", lambda d: f"{int(d[1],16)} km/h" if len(d)>=2 else None),
                        ("020500", "05", "Temp. Refrigerante", lambda d: f"{int(d[1],16)-40} °C" if len(d)>=2 else None),
                        ("020B00", "0B", "Presión MAP", lambda d: f"{int(d[1],16)} kPa" if len(d)>=2 else None),
                        ("020400", "04", "Carga Motor", lambda d: f"{round(int(d[1],16)*100/255, 1)}%" if len(d)>=2 else None),
                    ]
                    for q_cmd, q_pid, label, fn in ff_queries:
                        r = self._raw_cmd(q_cmd, delay=0.1)
                        db = extract_data_bytes(r, "42", q_pid)
                        if db:
                            val = fn(db)
                            if val is not None:
                                ff["params"][label] = val

            return {
                "ok": True,
                "mil_on": mil_on,
                "dtc_count": dtc_count,
                "confirmed": confirmed,
                "pending": pending,
                "permanent": permanent,
                "monitors": monitors,
                "freeze_frame": ff,
            }

    def clear_dtcs(self, force=False):
        """Ejecuta borrado Modo 04 verificando regla KOEO (motor apagado, contacto ON)."""
        with self.lock:
            if self.mode == "disconnected":
                return {"ok": False, "error": "No hay conexión activa"}
            if self.mode == "demo":
                return {"ok": True, "message": "Modo Demo: Códigos limpiados correctamente."}

            # Verificar RPM actuales antes de borrar
            raw_rpm = self._raw_cmd("010C", delay=0.1)
            d_rpm = extract_data_bytes(raw_rpm, "41", "0C")
            rpm = round((int(d_rpm[0], 16) * 256 + int(d_rpm[1], 16)) / 4.0) if len(d_rpm) >= 2 else 0
            if rpm > 0 and not force:
                return {
                    "ok": False,
                    "koeo_warning": True,
                    "rpm": rpm,
                    "error": f"El motor está en marcha ({rpm} RPM). Las ECUs Delphi/SsangYong exigen contacto ON con motor APAGADO (0 RPM) para aceptar el borrado (Modo 04).",
                }

            res = self._raw_cmd("04", delay=0.5)
            if "44" in res or "OK" in res:
                return {"ok": True, "raw": res, "message": "Memoria de fallas borrada correctamente (Respuesta 44)."}
            return {
                "ok": False,
                "raw": res,
                "error": f"La ECU respondió '{res or 'sin respuesta'}'. Verifica que la llave esté en contacto (ON) con motor apagado.",
            }

    def start_log(self):
        with self.lock:
            if self.logging:
                return self.log_path
            os.makedirs(LOGS_DIR, exist_ok=True)
            fname = f"musso_log_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
            self.log_path = os.path.join(LOGS_DIR, fname)
            self._log_file = open(self.log_path, "w", newline="", encoding="utf-8")
            self._log_headers = ["Timestamp"] + [s["id"] for s in SENSOR_CATALOG if s["id"] in self.supported_ids]
            self._log_writer = csv.DictWriter(self._log_file, fieldnames=self._log_headers)
            self._log_writer.writeheader()
            self._log_file.flush()
            self.logging = True
            return self.log_path

    def _write_log_row(self):
        if not self.logging or not self._log_writer:
            return
        row = {"Timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]}
        for h in self._log_headers[1:]:
            entry = self.latest.get(h)
            row[h] = entry["value"] if entry else ""
        self._log_writer.writerow(row)
        self._log_file.flush()

    def stop_log(self):
        with self.lock:
            self.logging = False
            if self._log_file:
                try:
                    self._log_file.close()
                except Exception:
                    pass
                self._log_file = None
                self._log_writer = None
            return self.log_path

    def get_status(self):
        with self.lock:
            return {
                "mode": self.mode,
                "ip": self.ip,
                "port": self.port,
                "adapter_version": self.adapter_version,
                "protocol": self.protocol,
                "battery_voltage": self.battery_voltage,
                "last_error": self.last_error,
                "last_poll_ms": self.last_poll_ms,
                "poll_count": self.poll_count,
                "watch_ids": list(self.watch_ids),
                "logging": self.logging,
                "log_path": os.path.basename(self.log_path) if self.log_path else None,
            }

    def get_telemetry_snapshot(self):
        with self.lock:
            return {
                "status": self.get_status(),
                "latest": dict(self.latest),
                "history": {k: list(v) for k, v in self.history.items() if k in self.watch_ids},
            }

    def send_raw(self, cmd, delay=0.08):
        with self.lock:
            if not self.sock:
                return {"ok": False, "error": "Adaptador no conectado", "raw": ""}
            try:
                res = self._raw_cmd(cmd.strip(), delay=delay)
                return {"ok": True, "cmd": cmd.strip(), "raw": res}
            except Exception as e:
                return {"ok": False, "error": str(e), "raw": ""}

    def send_batch(self, cmds, delay=0.06):
        with self.lock:
            if not self.sock:
                return {"ok": False, "error": "Adaptador no conectado", "results": {}}
            results = {}
            try:
                for c in cmds:
                    results[c] = self._raw_cmd(c.strip(), delay=delay)
                return {"ok": True, "results": results}
            except Exception as e:
                return {"ok": False, "error": str(e), "results": results}
