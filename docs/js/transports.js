/**
 * OBD2 Studio — Multi-Transport Abstraction Layer.
 * Soporta:
 *  1) Web Bluetooth (BLE GATT) - Chrome Desktop & Android (cero backend)
 *  2) Web Serial (USB / Bluetooth Classic COM / /dev/ttyUSB0) - Chrome/Edge Windows & Linux (cero backend)
 *  3) Wi-Fi Bridge (server.py local en 127.0.0.1:8080 para adaptadores ELM327 Wi-Fi TCP)
 *  4) Simulador Demo Client-Side (cero backend, funcional en GitHub Pages)
 */

(function (global) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // UUIDs conocidos de adaptadores ELM327 BLE (Vgate iCar Pro BLE, Veepeak, OBDLink CX, HM-10, Nordic)
  const BLE_PROFILES = [
    { service: "0000fff0-0000-1000-8000-00805f9b34fb", notify: "0000fff1-0000-1000-8000-00805f9b34fb", write: "0000fff2-0000-1000-8000-00805f9b34fb" },
    { service: "0000ffe0-0000-1000-8000-00805f9b34fb", notify: "0000ffe1-0000-1000-8000-00805f9b34fb", write: "0000ffe1-0000-1000-8000-00805f9b34fb" },
    { service: "e7810a71-73ae-499d-8c15-faa9aef0c3f2", notify: "bef8d6c9-9c21-4c9e-b632-bd58c100999f", write: "bef8d6c9-9c21-4c9e-b632-bd58c100999f" },
    { service: "6e400001-b5a3-f393-e0a9-e50e24dcca9e", notify: "6e400003-b5a3-f393-e0a9-e50e24dcca9e", write: "6e400002-b5a3-f393-e0a9-e50e24dcca9e" },
    { service: "000018f0-0000-1000-8000-00805f9b34fb", notify: "00002af0-0000-1000-8000-00805f9b34fb", write: "00002af1-0000-1000-8000-00805f9b34fb" },
  ];

  /** Clase base para drivers ELM327 directos en el navegador (BLE y Serial). */
  class DirectELMEngine {
    constructor() {
      this.mode = "disconnected";
      this.adapterVersion = null;
      this.protocol = null;
      this.batteryVoltage = null;
      this.supportedIds = OBDCore.SENSOR_CATALOG.map((s) => s.id);
      this.latest = {};
      this.history = {};
      this.lastPollMs = 0;
      this.lastError = null;
      this._busy = false;
      this._queue = Promise.resolve();
    }

    _enqueue(fn) {
      const p = this._queue.then(fn, fn);
      this._queue = p.catch(() => {});
      return p;
    }

    async initELM() {
      const atz = await this.sendAT("ATZ", 600);
      await this.sendAT("ATE0", 150);
      await this.sendAT("ATL0", 150);
      await this.sendAT("ATSP0", 200);
      await this.sendAT("ATST32", 150);
      const atrv = await this.sendAT("ATRV", 200);
      const parsedV = parseFloat(String(atrv).replace(/[^0-9.]/g, ""));
      if (!Number.isNaN(parsedV)) this.batteryVoltage = parsedV;
      this.adapterVersion = (atz || "ELM327").replace(/ATZ/gi, "").trim() || "ELM327 Browser";
      this.protocol = "CAN / Auto (Directo Navegador)";
      await this.discoverPids();
    }

    async discoverPids() {
      const found = new Set();
      const ranges = [["0100", 0x00], ["0120", 0x20], ["0140", 0x40], ["0160", 0x60], ["0180", 0x80]];
      for (const [cmd, base] of ranges) {
        const raw = await this.sendAT(cmd, 250);
        const bytes = OBDCore.extractDataBytes(raw, "41", cmd.slice(2));
        if (bytes.length >= 4) {
          OBDCore.parseBitmaskPids(base, bytes).forEach((p) => found.add(p));
        } else {
          break;
        }
      }
      if (found.size > 0) {
        const matched = OBDCore.SENSOR_CATALOG.filter((s) => s.pid === "ATRV" || found.has(s.pid)).map((s) => s.id);
        if (matched.length) this.supportedIds = matched;
      }
    }

    _record(id, val, rawHex = "") {
      const ts = Date.now() / 1000;
      const d = new Date();
      const timeStr = d.toTimeString().slice(0, 8);
      this.latest[id] = { id, value: val, raw: rawHex, ts, time: timeStr };
      if (!this.history[id]) this.history[id] = [];
      this.history[id].push({ t: timeStr, v: val });
      if (this.history[id].length > 180) this.history[id].shift();
    }

    async pollIds(targetIds) {
      return this._enqueue(async () => {
        const t0 = performance.now();
        const groups = new Map();
        for (const id of targetIds) {
          const meta = OBDCore.CATALOG_BY_ID[id];
          if (!meta) continue;
          if (!groups.has(meta.pid)) groups.set(meta.pid, []);
          groups.get(meta.pid).push(meta);
        }
        for (const [pid, metas] of groups.entries()) {
          if (this.mode === "disconnected") break;
          if (pid === "ATRV") {
            const raw = await this.sendAT("ATRV", 120);
            const v = parseFloat(String(raw).replace(/[^0-9.]/g, ""));
            if (!Number.isNaN(v)) {
              this.batteryVoltage = v;
              metas.forEach((m) => this._record(m.id, v, raw));
            }
            continue;
          }
          const raw = await this.sendAT(pid, 140);
          const data = OBDCore.extractDataBytes(raw, "41", pid.slice(2));
          if (!data.length) continue;
          for (const m of metas) {
            if (data.length >= m.min_bytes && m.decoder) {
              const val = m.decoder(data);
              if (val !== null && val !== undefined && !Number.isNaN(val)) {
                this._record(m.id, val, data.join(" "));
              }
            }
          }
        }
        this.lastPollMs = Math.round(performance.now() - t0);
      });
    }

    async readDTCs() {
      return this._enqueue(async () => {
        const raw0101 = await this.sendAT("0101", 200);
        const b0101 = OBDCore.extractDataBytes(raw0101, "41", "01");
        let milOn = false;
        let dtcCount = 0;
        const monitors = {};
        if (b0101.length >= 4) {
          const ba = parseInt(b0101[0], 16);
          const bb = parseInt(b0101[1], 16);
          const bd = parseInt(b0101[3], 16);
          milOn = Boolean(ba & 0x80);
          dtcCount = ba & 0x7f;
          monitors.misfire = !(bb & 0x10) ? "OK" : "Pendiente";
          monitors.fuel_system = !(bb & 0x20) ? "OK" : "Pendiente";
          monitors.components = !(bb & 0x40) ? "OK" : "Pendiente";
          monitors.egr_vvt = !(bd & 0x80) ? "OK" : "Pendiente";
          monitors.dpf_pm = !(bd & 0x40) ? "OK" : "Pendiente";
        }

        const parseMode = async (cmdHex, respMode) => {
          const raw = await this.sendAT(cmdHex, 250);
          if (!raw || /NO DATA/i.test(raw)) return [];
          const tokens = raw.replace(/[:\r\n]/g, " ").trim().split(/\s+/).filter((t) => /^[0-9A-Fa-f]{2}$/.test(t)).map((t) => t.toUpperCase());
          const idx = tokens.indexOf(respMode);
          if (idx === -1) return [];
          let payload = tokens.slice(idx + 1);
          if (payload.length % 2 !== 0) payload = payload.slice(1);
          const list = [];
          for (let i = 0; i < payload.length - 1; i += 2) {
            const code = OBDCore.decodeDtcPair(payload[i], payload[i + 1]);
            if (code) list.push({ code, description: OBDCore.describeDtc(code) });
          }
          return list;
        };

        const confirmed = await parseMode("03", "43");
        const pending = await parseMode("07", "47");
        const permanent = await parseMode("0A", "4A");

        let ff = null;
        const rawFf = await this.sendAT("020200", 200);
        const ffBytes = OBDCore.extractDataBytes(rawFf, "42", "02");
        if (ffBytes.length >= 3) {
          const ffCode = OBDCore.decodeDtcPair(ffBytes[1], ffBytes[2]);
          if (ffCode) {
            ff = { dtc: ffCode, description: OBDCore.describeDtc(ffCode), params: {} };
            const queries = [
              ["020C00", "0C", "RPM", (d) => (d.length >= 3 ? `${Math.round((parseInt(d[1], 16) * 256 + parseInt(d[2], 16)) / 4)} RPM` : null)],
              ["020D00", "0D", "Velocidad", (d) => (d.length >= 2 ? `${parseInt(d[1], 16)} km/h` : null)],
              ["020500", "05", "Temp. Refrigerante", (d) => (d.length >= 2 ? `${parseInt(d[1], 16) - 40} °C` : null)],
              ["020B00", "0B", "Presión MAP", (d) => (d.length >= 2 ? `${parseInt(d[1], 16)} kPa` : null)],
            ];
            for (const [qc, qp, lbl, fn] of queries) {
              const qr = await this.sendAT(qc, 150);
              const qb = OBDCore.extractDataBytes(qr, "42", qp);
              const val = qb.length ? fn(qb) : null;
              if (val) ff.params[lbl] = val;
            }
          }
        }

        return { ok: true, mil_on: milOn, dtc_count: dtcCount, confirmed, pending, permanent, monitors, freeze_frame: ff };
      });
    }

    async clearDTCs(force = false) {
      return this._enqueue(async () => {
        const rawRpm = await this.sendAT("010C", 150);
        const dRpm = OBDCore.extractDataBytes(rawRpm, "41", "0C");
        const rpm = dRpm.length >= 2 ? Math.round((parseInt(dRpm[0], 16) * 256 + parseInt(dRpm[1], 16)) / 4) : 0;
        if (rpm > 0 && !force) {
          return {
            ok: false,
            koeo_warning: true,
            error: `Motor en marcha (${rpm} RPM). Poné contacto ON con motor APAGADO (0 RPM) para borrar fallas (KOEO).`,
          };
        }
        const res = await this.sendAT("04", 600);
        if (/44|OK/i.test(res)) return { ok: true, message: "Memoria de fallas borrada correctamente." };
        return { ok: false, error: `La ECU respondió '${res || "sin datos"}'. Verificá contacto ON sin marcha.` };
      });
    }

    async readVehicleInfo() {
      return this._enqueue(async () => {
        const rawVin = await this.sendAT("0902", 300);
        const rawCal = await this.sendAT("0904", 250);
        const rawEcu = await this.sendAT("090A", 250);
        const rawProto = await this.sendAT("ATDP", 150);
        return {
          vin: OBDCore.parseMode09Ascii(rawVin, "02"),
          cal_id: OBDCore.parseMode09Ascii(rawCal, "04"),
          ecu_name: OBDCore.parseMode09Ascii(rawEcu, "0A"),
          protocol: rawProto || this.protocol,
        };
      });
    }

    async sendRaw(cmd) {
      return this._enqueue(async () => {
        const raw = await this.sendAT(cmd, 800);
        return { ok: true, cmd, raw: raw || "(sin respuesta)" };
      });
    }
  }

  /** Driver 1: Web Bluetooth (BLE) directo desde Chrome/Edge Desktop y Android */
  class WebBluetoothTransport extends DirectELMEngine {
    constructor() {
      super();
      this.device = null;
      this.writeChar = null;
      this.notifyChar = null;
      this._rxBuffer = "";
      this._rxResolver = null;
    }

    async connect() {
      if (!navigator.bluetooth) {
        return { ok: false, message: "Tu navegador no soporta Web Bluetooth. Usá Chrome o Edge en Android, Windows, macOS o Linux." };
      }
      try {
        const optionalServices = BLE_PROFILES.map((p) => p.service);
        this.device = await navigator.bluetooth.requestDevice({
          acceptAllDevices: true,
          optionalServices,
        });
        this.device.addEventListener("gattserverdisconnected", () => {
          this.mode = "disconnected";
          this.lastError = "Adaptador Bluetooth BLE desconectado.";
        });

        const server = await this.device.gatt.connect();
        for (const prof of BLE_PROFILES) {
          try {
            const svc = await server.getPrimaryService(prof.service);
            const chars = await svc.getCharacteristics();
            this.notifyChar = chars.find((c) => c.uuid === prof.notify) || chars.find((c) => c.properties.notify || c.properties.indicate);
            this.writeChar = chars.find((c) => c.uuid === prof.write) || chars.find((c) => c.properties.write || c.properties.writeWithoutResponse);
            if (this.notifyChar && this.writeChar) break;
          } catch (_) {}
        }

        if (!this.notifyChar || !this.writeChar) {
          throw new Error("No se encontraron características UART/ELM327 compatibles en este dispositivo BLE.");
        }

        await this.notifyChar.startNotifications();
        this.notifyChar.addEventListener("characteristicvaluechanged", (ev) => {
          const text = new TextDecoder().decode(ev.target.value);
          this._rxBuffer += text;
          if (this._rxBuffer.includes(">") && this._rxResolver) {
            const out = this._rxBuffer.replace(/>/g, "").trim();
            this._rxBuffer = "";
            const res = this._rxResolver;
            this._rxResolver = null;
            res(out);
          }
        });

        this.mode = "ble";
        await this.initELM();
        return { ok: true, message: `Conectado por Bluetooth BLE a ${this.device.name || "ELM327"}` };
      } catch (e) {
        this.mode = "disconnected";
        return { ok: false, message: `Error Web Bluetooth: ${e.message}` };
      }
    }

    async sendAT(cmd, timeoutMs = 1500) {
      if (!this.writeChar) return "";
      this._rxBuffer = "";
      const payload = new TextEncoder().encode(cmd + "\r");
      return new Promise(async (resolve) => {
        const timer = setTimeout(() => {
          const out = this._rxBuffer.replace(/>/g, "").trim();
          this._rxBuffer = "";
          this._rxResolver = null;
          resolve(out);
        }, timeoutMs);

        this._rxResolver = (out) => {
          clearTimeout(timer);
          resolve(out);
        };

        try {
          if (this.writeChar.properties.writeWithoutResponse) {
            await this.writeChar.writeValueWithoutResponse(payload);
          } else {
            await this.writeChar.writeValue(payload);
          }
        } catch (_) {
          clearTimeout(timer);
          this._rxResolver = null;
          resolve("");
        }
      });
    }

    async disconnect() {
      this.mode = "disconnected";
      try {
        if (this.device && this.device.gatt.connected) this.device.gatt.disconnect();
      } catch (_) {}
    }
  }

  /** Driver 2: Web Serial (USB / Bluetooth Classic COM / /dev/ttyUSB0) directo en Chrome/Edge PC */
  class WebSerialTransport extends DirectELMEngine {
    constructor() {
      super();
      this.port = null;
      this.reader = null;
      this.writer = null;
      this._rxBuffer = "";
      this._rxResolver = null;
      this._reading = false;
    }

    async connect(baudRate = 38400) {
      if (!navigator.serial) {
        return { ok: false, message: "Tu navegador no soporta Web Serial. Usá Chrome o Edge en Windows, Linux o macOS." };
      }
      try {
        this.port = await navigator.serial.requestPort();
        await this.port.open({ baudRate: Number(baudRate) || 38400 });
        this.writer = this.port.writable.getWriter();
        this.reader = this.port.readable.getReader();
        this._reading = true;
        this._readLoop();
        this.mode = "serial";
        await this.initELM();
        return { ok: true, message: `Conectado por Web Serial (${baudRate} baud)` };
      } catch (e) {
        this.mode = "disconnected";
        return { ok: false, message: `Error Web Serial: ${e.message}` };
      }
    }

    async _readLoop() {
      const dec = new TextDecoder();
      while (this._reading && this.reader) {
        try {
          const { value, done } = await this.reader.read();
          if (done) break;
          if (value) {
            this._rxBuffer += dec.decode(value, { stream: true });
            if (this._rxBuffer.includes(">") && this._rxResolver) {
              const out = this._rxBuffer.replace(/>/g, "").trim();
              this._rxBuffer = "";
              const res = this._rxResolver;
              this._rxResolver = null;
              res(out);
            }
          }
        } catch (_) {
          break;
        }
      }
    }

    async sendAT(cmd, timeoutMs = 1500) {
      if (!this.writer) return "";
      this._rxBuffer = "";
      const payload = new TextEncoder().encode(cmd + "\r");
      return new Promise(async (resolve) => {
        const timer = setTimeout(() => {
          const out = this._rxBuffer.replace(/>/g, "").trim();
          this._rxBuffer = "";
          this._rxResolver = null;
          resolve(out);
        }, timeoutMs);

        this._rxResolver = (out) => {
          clearTimeout(timer);
          resolve(out);
        };

        try {
          await this.writer.write(payload);
        } catch (_) {
          clearTimeout(timer);
          this._rxResolver = null;
          resolve("");
        }
      });
    }

    async disconnect() {
      this.mode = "disconnected";
      this._reading = false;
      try { if (this.reader) { await this.reader.cancel(); this.reader.releaseLock(); } } catch (_) {}
      try { if (this.writer) this.writer.releaseLock(); } catch (_) {}
      try { if (this.port) await this.port.close(); } catch (_) {}
    }
  }

  /** Driver 3: Simulador Demo 100% client-side (funciona en GitHub Pages sin backend) */
  class DemoTransport {
    constructor() {
      this.mode = "demo";
      this.startTs = Date.now();
      this.latest = {};
      this.history = {};
      this.supportedIds = OBDCore.SENSOR_CATALOG.map((s) => s.id);
      this.adapterVersion = "Simulador Musso 2.2 (Browser)";
      this.protocol = "ISO 15765-4 CAN (500 kbps)";
      this.batteryVoltage = 14.2;
      this.lastPollMs = 18;
    }

    async connect() {
      this.mode = "demo";
      this.startTs = Date.now();
      return { ok: true, message: "Modo Simulador Demo iniciado (100% en navegador)" };
    }

    async disconnect() {
      this.mode = "disconnected";
    }

    async pollIds(targetIds) {
      const elapsed = (Date.now() - this.startTs) / 1000;
      const coolant = Math.min(87.5, 42.0 + elapsed * 0.45) + Math.sin(elapsed * 0.2) * 0.4;
      const wave = Math.max(0, Math.sin(elapsed * 0.35));
      const rev = wave > 0.65 ? (wave - 0.65) / 0.35 : 0;

      const sim = {
        "0105": Math.round(coolant * 10) / 10,
        "0167": Math.round((coolant - 0.5) * 10) / 10,
        "015C": Math.round(Math.min(84, 38 + elapsed * 0.35) * 10) / 10,
        "016B": Math.round((78 + rev * 65) * 10) / 10,
        "010F": Math.round((27 + Math.sin(elapsed * 0.1) * 1.2) * 10) / 10,
        "0168": Math.round((29 + rev * 4) * 10) / 10,
        "0177": Math.round((31 + rev * 9) * 10) / 10,
        "0175": Math.round((165 + rev * 120) * 10) / 10,
        "0146": 21,
        "010B": Math.round(102 + rev * 42),
        "0133": 100,
        "0170_CMD": Math.round((109 + rev * 48) * 10) / 10,
        "0170_ACT": Math.round((102 + rev * 42) * 10) / 10,
        "0171": Math.round((72 - rev * 35) * 10) / 10,
        "0110": Math.round((8.5 + rev * 36) * 100) / 100,
        "012C": Math.round(35 * (1 - rev) * 10) / 10,
        "012D": Math.round(Math.sin(elapsed * 0.5) * 1.8 * 10) / 10,
        "0111": Math.round((84 + rev * 15) * 10) / 10,
        "014C": Math.round((84 + rev * 15) * 10) / 10,
        ATRV: 14.2,
        "0142": 14.15,
        "012F": 64.5,
        "011F": Math.round(elapsed + 120),
        "0121": 0,
        "0131": 12,
        "010C": Math.round(780 + rev * 1750 + Math.sin(elapsed * 3) * 8),
        "010D": 0,
        "0104": Math.round((17.5 + rev * 32) * 10) / 10,
        "0149": Math.round((18.8 + rev * 24) * 10) / 10,
        "0123": Math.round((265 + rev * 490) * 10) / 10,
        "015E": Math.round((0.9 + rev * 4.2) * 100) / 100,
        "0162": Math.round(12 + rev * 35),
        "0163": 420,
        "017A": Math.round((10.8 + rev * 14) * 10) / 10,
        "017C_IN": Math.round((105 + rev * 90) * 10) / 10,
        "017C_OUT": Math.round((92 + rev * 72) * 10) / 10,
        "018C": 33.2,
        "0178": Math.round((140 + rev * 110) * 10) / 10,
      };

      const timeStr = new Date().toTimeString().slice(0, 8);
      const ts = Date.now() / 1000;
      for (const id of targetIds) {
        if (sim[id] !== undefined) {
          this.latest[id] = { id, value: sim[id], raw: "SIM", ts, time: timeStr };
          if (!this.history[id]) this.history[id] = [];
          this.history[id].push({ t: timeStr, v: sim[id] });
          if (this.history[id].length > 180) this.history[id].shift();
        }
      }
      await sleep(20);
    }

    async readDTCs() {
      return {
        ok: true,
        mil_on: false,
        dtc_count: 0,
        confirmed: [],
        pending: [],
        permanent: [],
        monitors: { misfire: "OK", fuel_system: "OK", components: "OK", egr_vvt: "OK", dpf_pm: "OK" },
        freeze_frame: null,
        note: "Modo Demo: sin códigos de falla tras armado de admisión.",
      };
    }

    async clearDTCs() {
      return { ok: true, message: "Modo Demo: Códigos limpiados correctamente." };
    }

    async readVehicleInfo() {
      return {
        vin: "DEMO-MUSSO-2022-D22DTR",
        cal_id: "DCM62AP-DEMO-CAL",
        ecu_name: "ECM-Delphi-D22DTR",
        protocol: "ISO 15765-4 CAN (500 kbps)",
      };
    }

    async sendRaw(cmd) {
      const c = cmd.trim().toUpperCase();
      if (c === "ATZ") return { ok: true, cmd, raw: "ELM327 v2.1 (Simulador)" };
      if (c === "ATRV") return { ok: true, cmd, raw: "14.2V" };
      if (c === "ATDP") return { ok: true, cmd, raw: "AUTO, ISO 15765-4 (CAN 11/500)" };
      if (c === "0902") return { ok: true, cmd, raw: "49 02 01 44 45 4D 4F 2D 4D 55 53 53 4F" };
      if (c === "0105") return { ok: true, cmd, raw: "41 05 7C" };
      return { ok: true, cmd, raw: `SIM OK (${c})` };
    }
  }

  /** Driver 4: Bridge Local Python (Windows / Linux) via /api/raw + /api/batch */
  class WiFiBridgeTransport extends DirectELMEngine {
    constructor(baseUrl = "http://127.0.0.1:8080") {
      super();
      this.baseUrl = baseUrl;
    }

    async _api(path, opts = {}) {
      const url = (window.location.origin.startsWith("http://127.0.0.1") || window.location.origin.startsWith("http://localhost"))
        ? path
        : this.baseUrl + path;
      const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...opts });
      return res.json();
    }

    async connect(ip = "192.168.0.10", port = 35000) {
      try {
        const res = await this._api("/api/connect", {
          method: "POST",
          body: JSON.stringify({ ip, port, mode: "relay" }),
        });
        if (res.ok) {
          this.mode = "wifi";
          this.adapterVersion = res.obd?.adapter_version || "ELM327 Wi-Fi";
          this.protocol = res.obd?.protocol || "ISO 15765-4 CAN (Wi-Fi Bridge)";
          this.batteryVoltage = res.obd?.battery_voltage;
          await this.discoverPids();
        }
        return res;
      } catch (e) {
        return {
          ok: false,
          message: "No se detectó el Bridge local en 127.0.0.1:8080. Descargá y ejecutá obd2-wifi-bridge.py abajo.",
        };
      }
    }

    async sendAT(cmd, timeoutMs = 1500) {
      try {
        const delay = Math.min(0.4, Math.max(0.05, timeoutMs / 3500));
        const res = await this._api("/api/raw", {
          method: "POST",
          body: JSON.stringify({ cmd, delay }),
        });
        if (!res.ok && res.error && /no conectado|not connected/i.test(res.error)) {
          this.mode = "disconnected";
        }
        return res.raw || "";
      } catch (_) {
        return "";
      }
    }

    async pollIds(targetIds) {
      return this._enqueue(async () => {
        const t0 = performance.now();
        const groups = new Map();
        for (const id of targetIds) {
          const meta = OBDCore.CATALOG_BY_ID[id];
          if (!meta) continue;
          if (!groups.has(meta.pid)) groups.set(meta.pid, []);
          groups.get(meta.pid).push(meta);
        }
        const cmds = Array.from(groups.keys());
        if (!cmds.length) return;
        try {
          const res = await this._api("/api/batch", {
            method: "POST",
            body: JSON.stringify({ cmds, delay: 0.05 }),
          });
          if (!res.ok) {
            if (res.error && /no conectado|not connected/i.test(res.error)) this.mode = "disconnected";
            return;
          }
          const results = res.results || {};
          for (const [pid, metas] of groups.entries()) {
            const raw = results[pid] || "";
            if (pid === "ATRV") {
              const v = parseFloat(String(raw).replace(/[^0-9.]/g, ""));
              if (!Number.isNaN(v)) {
                this.batteryVoltage = v;
                metas.forEach((m) => this._record(m.id, v, raw));
              }
              continue;
            }
            const data = OBDCore.extractDataBytes(raw, "41", pid.slice(2));
            if (!data.length) continue;
            for (const m of metas) {
              if (data.length >= m.min_bytes && m.decoder) {
                const val = m.decoder(data);
                if (val !== null && val !== undefined && !Number.isNaN(val)) {
                  this._record(m.id, val, data.join(" "));
                }
              }
            }
          }
          this.lastPollMs = Math.round(performance.now() - t0);
        } catch (_) {
          this.mode = "disconnected";
        }
      });
    }

    async disconnect() {
      this.mode = "disconnected";
      try { await this._api("/api/disconnect", { method: "POST", body: "{}" }); } catch (_) {}
    }
  }

  global.OBDTransports = {
    WebBluetoothTransport,
    WebSerialTransport,
    DemoTransport,
    WiFiBridgeTransport,
  };
})(window);
