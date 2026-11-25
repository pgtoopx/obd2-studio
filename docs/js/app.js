/**
 * OBD2 Studio — Main UI Controller (Static PWA + Multi-Transport)
 */

const POST_ASSEMBLY_WATCH_IDS = [
  "0105", "0167", "015C", "016B", "010F", "0177", "0146",
  "010B", "0133", "0170_CMD", "0170_ACT", "0171",
  "0110", "012C", "012D", "0111", "010C", "0123", "0149",
  "ATRV", "0142", "012F", "011F", "017A",
];

const CHECKLIST_ITEMS = [
  { id: "c1", text: "Nivel de refrigerante en vaso expansor (en frío entre MIN y MAX)" },
  { id: "c2", text: "Calefacción de cabina abierta al máximo durante el purgado inicial" },
  { id: "c3", text: "Verificar apertura de termostato (~82-88°C) y manguera inferior caliente" },
  { id: "c4", text: "Comprobar que no haya burbujas ni pérdida de coolant en enfriador EGR" },
  { id: "c5", text: "Revisar ajuste de todas las abrazaderas de admisión e intercooler" },
  { id: "c6", text: "Confirmar presión MAP = Barométrica (~100 kPa) antes de dar arranque" },
  { id: "c7", text: "Verificar conectores firmes: MAP, MAF, EGR, Mariposa y sensor ECT" },
  { id: "c8", text: "Revisar nivel de aceite en varilla y ausencia de fugas tras calentar" },
];

const DEFAULT_CUSTOM_VIEWS = [
  {
    id: "cooling_bleed",
    name: "Purgado Refrigerante & Térmico",
    icon: "🌡️",
    description: "Control estricto tras vaciar coolant y armar enfriador EGR",
    widgets: [
      { sensor_id: "0105", type: "chart" },
      { sensor_id: "0167", type: "gauge" },
      { sensor_id: "016B", type: "chart" },
      { sensor_id: "015C", type: "gauge" },
      { sensor_id: "011F", type: "card" },
      { sensor_id: "010C", type: "card" },
    ],
  },
  {
    id: "intake_leak",
    name: "Hermeticidad Admisión & Turbo",
    icon: "🌀",
    description: "Verifica fugas en juntas, abrazaderas de intercooler y respuesta EGR/MAP",
    widgets: [
      { sensor_id: "010B", type: "chart" },
      { sensor_id: "0170_CMD", type: "chart" },
      { sensor_id: "0170_ACT", type: "chart" },
      { sensor_id: "0110", type: "gauge" },
      { sensor_id: "012D", type: "gauge" },
      { sensor_id: "012C", type: "card" },
      { sensor_id: "0177", type: "card" },
      { sensor_id: "010F", type: "card" },
    ],
  },
];

let activeTransport = null; // null | WebBluetoothTransport | WebSerialTransport | WiFiBridgeTransport | DemoTransport
let transportType = "disconnected"; // disconnected | ble | serial | wifi | demo
let activeTab = "post_assembly";
let activeCategoryFilter = "all";
let customViews = [];
let activeCustomViewId = null;
let editingViewId = null;
let builderSelections = {};
let quickAddTargetSensor = null;
let pollTimer = null;
let isPolling = false;
let deferredInstallPrompt = null;

// Logger CSV en memoria del navegador (universal Windows/Linux/Android)
let isRecordingCsv = false;
let csvRows = [];

async function initApp() {
  registerPWA();
  detectCapabilities();
  loadCustomViews();
  renderPostAssemblySkeleton();
  renderChecklist();
  renderCategoryPills();
  renderAllSensors();
  checkLocalBridgeAvailability();
}

function registerPWA() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    document.getElementById("btnInstallPwa")?.classList.remove("hidden");
  });
}

async function installPWA() {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  document.getElementById("btnInstallPwa")?.classList.add("hidden");
}

function detectCapabilities() {
  const bleBtn = document.getElementById("btnConnBle");
  const serBtn = document.getElementById("btnConnSerial");
  if (!navigator.bluetooth && bleBtn) {
    bleBtn.title = "Tu navegador no soporta Web Bluetooth (usá Chrome/Edge en Android, Windows, Linux o macOS)";
    bleBtn.classList.add("opacity-60");
  }
  if (!navigator.serial && serBtn) {
    serBtn.title = "Tu navegador no soporta Web Serial (usá Chrome/Edge de escritorio en Windows/Linux/macOS)";
    serBtn.classList.add("opacity-60");
  }
}

async function checkLocalBridgeAvailability() {
  try {
    const baseUrl = getBridgeUrl();
    const res = await fetch(`${baseUrl}/api/status`, { method: "GET" });
    if (res.ok) {
      const data = await res.json();
      updateWifiBadge(data.wifi);
      document.getElementById("bridgeHint")?.classList.add("hidden");
    }
  } catch (_) {
    // No hay bridge local corriendo (normal cuando se abre directo desde GitHub Pages sin adaptador Wi-Fi)
  }
}

function getBridgeUrl() {
  if (window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost") {
    return window.location.origin;
  }
  return document.getElementById("inpBridgeUrl")?.value.trim() || "http://127.0.0.1:8080";
}

function getSupportedIds() {
  if (activeTransport && activeTransport.supportedIds) return activeTransport.supportedIds;
  return OBDCore.SENSOR_CATALOG.map((s) => s.id);
}

function getWatchIdsForActiveTab() {
  if (activeTab === "post_assembly") return POST_ASSEMBLY_WATCH_IDS;
  if (activeTab === "custom_views") {
    const v = customViews.find((x) => x.id === activeCustomViewId);
    return v ? v.widgets.map((w) => w.sensor_id) : [];
  }
  if (activeTab === "all_sensors") {
    return getFilteredCatalog().slice(0, 18).map((s) => s.id);
  }
  return POST_ASSEMBLY_WATCH_IDS;
}

// =========================================================
// CONEXIÓN MULTI-TRANSPORTE
// =========================================================
async function connectMode(mode) {
  await disconnectOBD(true);
  showConnAlert(`Iniciando conexión (${mode.toUpperCase()})...`, "info");

  if (mode === "ble") {
    const t = new OBDTransports.WebBluetoothTransport();
    const res = await t.connect();
    if (!res.ok) return showConnAlert(res.message, "error");
    activeTransport = t;
    transportType = "ble";
    showConnAlert(res.message, "success");
  } else if (mode === "serial") {
    const baud = document.getElementById("inpBaud")?.value || 38400;
    const t = new OBDTransports.WebSerialTransport();
    const res = await t.connect(baud);
    if (!res.ok) return showConnAlert(res.message, "error");
    activeTransport = t;
    transportType = "serial";
    showConnAlert(res.message, "success");
  } else if (mode === "wifi") {
    const ip = document.getElementById("inpIp")?.value.trim() || "192.168.0.10";
    const port = parseInt(document.getElementById("inpPort")?.value || "35000", 10);
    const t = new OBDTransports.WiFiBridgeTransport(getBridgeUrl());
    const res = await t.connect(ip, port);
    if (!res.ok) {
      document.getElementById("bridgeHelpBox")?.classList.remove("hidden");
      return showConnAlert(res.message, "error");
    }
    document.getElementById("bridgeHelpBox")?.classList.add("hidden");
    activeTransport = t;
    transportType = "wifi";
    await t.setWatch(getWatchIdsForActiveTab());
    showConnAlert(res.message || "Conectado por Wi-Fi Bridge", "success");
  } else if (mode === "demo") {
    const t = new OBDTransports.DemoTransport();
    const res = await t.connect();
    activeTransport = t;
    transportType = "demo";
    showConnAlert(res.message, "success");
  }

  updateConnectionHeader();
  document.getElementById("sensorCountBadge").innerText = getSupportedIds().length;
  renderAllSensors();
  startPolling();
  await scanDTCs();
}

async function disconnectOBD(silent = false) {
  stopPolling();
  if (activeTransport) {
    await activeTransport.disconnect();
    activeTransport = null;
  }
  transportType = "disconnected";
  updateConnectionHeader();
  if (!silent) showConnAlert("Sesión OBD-II cerrada.", "info");
}

async function connectWifiVLink() {
  try {
    showConnAlert("Conectando interfaz Wi-Fi del equipo a V-LINK (via Bridge)...", "info");
    const res = await fetch(`${getBridgeUrl()}/api/wifi/connect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ssid: "V-LINK" }),
    });
    const data = await res.json();
    updateWifiBadge(data.wifi);
    showConnAlert(data.ok ? "Solicitud Wi-Fi enviada a V-LINK." : data.message, data.ok ? "success" : "error");
  } catch (_) {
    showConnAlert("Para conectar el Wi-Fi automáticamente desde la web, iniciá primero el Bridge local (start_windows.bat o start_linux.sh). O conectate manualmente a la red Wi-Fi 'V-LINK'.", "info");
  }
}

function updateWifiBadge(wifi) {
  const lbl = document.getElementById("wifiBtnLabel");
  const btn = document.getElementById("btnWifi");
  if (!lbl || !btn || !wifi) return;
  if (wifi.connected && wifi.ssid && wifi.ssid.toUpperCase() === "V-LINK") {
    lbl.innerText = `V-LINK (${wifi.signal || "OK"})`;
    btn.className = "px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-950/60 border border-emerald-500/40 text-emerald-300 flex items-center gap-1.5";
  } else if (wifi.vlink_visible) {
    lbl.innerText = "Conectar V-LINK";
    btn.className = "px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-amber-950/50 border border-amber-500/40 text-amber-300 flex items-center gap-1.5";
  }
}

function updateConnectionHeader() {
  const badge = document.getElementById("connBadge");
  const dot = document.getElementById("connDot");
  const txt = document.getElementById("connText");
  const sub = document.getElementById("adapterSubtitle");
  const discBtn = document.getElementById("btnDisconnect");
  const connectBtns = document.getElementById("connectButtonsGroup");

  if (transportType === "disconnected") {
    badge.className = "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-800 text-slate-300 border border-slate-700";
    dot.className = "w-2 h-2 rounded-full bg-slate-500";
    txt.innerText = "Desconectado";
    sub.innerText = "BLE / USB Serial directo en navegador • Wi-Fi via Bridge";
    discBtn.classList.add("hidden");
    connectBtns.classList.remove("hidden");
  } else {
    const labels = {
      ble: ["Bluetooth BLE", "bg-sky-500/20 text-sky-300 border-sky-500/40", "bg-sky-400"],
      serial: ["USB / Serial", "bg-indigo-500/20 text-indigo-300 border-indigo-500/40", "bg-indigo-400"],
      wifi: ["Wi-Fi Bridge", "bg-emerald-500/20 text-emerald-300 border-emerald-500/40", "bg-emerald-400"],
      demo: ["Simulador Demo", "bg-amber-500/20 text-amber-300 border-amber-500/40", "bg-amber-400"],
    };
    const [label, cls, dotCls] = labels[transportType];
    badge.className = `inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${cls}`;
    dot.className = `w-2 h-2 rounded-full ${dotCls} pulse-dot`;
    txt.innerText = label;
    sub.innerText = `${activeTransport?.adapterVersion || "ELM327"} • ${activeTransport?.protocol || ""}`;
    discBtn.classList.remove("hidden");
    connectBtns.classList.add("hidden");
  }
}

function showConnAlert(msg, type = "info") {
  const el = document.getElementById("connAlert");
  el.classList.remove("hidden");
  const styles = {
    error: "bg-red-950/60 border-red-500/40 text-red-200",
    success: "bg-emerald-950/60 border-emerald-500/40 text-emerald-200",
    info: "bg-sky-950/60 border-sky-500/40 text-sky-200",
  };
  el.className = `mt-2.5 px-3 py-2 rounded-xl text-xs border flex items-center justify-between gap-2 ${styles[type] || styles.info}`;
  el.innerHTML = `<span>${msg}</span><button onclick="this.parentElement.classList.add('hidden')" class="font-bold opacity-70 hover:opacity-100">&times;</button>`;
}

// =========================================================
// POLLING LOOP UNIFICADO
// =========================================================
function startPolling() {
  stopPolling();
  const interval = transportType === "demo" ? 500 : 450;
  pollTimer = setInterval(async () => {
    if (!activeTransport || isPolling || transportType === "disconnected") return;
    isPolling = true;
    try {
      const watchIds = getWatchIdsForActiveTab();
      if (transportType === "wifi") {
        await activeTransport.syncTelemetry();
        if (activeTransport.mode === "disconnected") {
          await disconnectOBD(true);
          showConnAlert("Se perdió la conexión con el adaptador Wi-Fi.", "error");
          return;
        }
      } else {
        await activeTransport.pollIds(watchIds);
      }

      if (activeTransport.batteryVoltage) {
        const vStr = `${Number(activeTransport.batteryVoltage).toFixed(1)} V`;
        document.getElementById("batBadge").innerText = vStr;
        document.getElementById("batBadgeMob").innerText = vStr;
      }
      document.getElementById("pollBadge").innerText = `${activeTransport.lastPollMs || "--"} ms`;

      if (isRecordingCsv) captureCsvRow();

      if (activeTab === "post_assembly") updatePostAssemblyUI();
      else if (activeTab === "all_sensors") updateAllSensorsValues();
      else if (activeTab === "custom_views") updateCustomViewValues();
    } catch (_) {
    } finally {
      isPolling = false;
    }
  }, interval);
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  isPolling = false;
}

// =========================================================
// GRABADOR CSV EN NAVEGADOR (UNIVERSAL WINDOWS/LINUX/ANDROID)
// =========================================================
function toggleLogging() {
  const dot = document.getElementById("logDot");
  const lbl = document.getElementById("logLabel");
  if (!isRecordingCsv) {
    isRecordingCsv = true;
    csvRows = [];
    dot.className = "w-2 h-2 rounded-full bg-red-500 pulse-dot";
    lbl.innerText = "Detener & Bajar CSV";
    showConnAlert("Grabando telemetría en memoria del navegador...", "info");
  } else {
    isRecordingCsv = false;
    dot.className = "w-2 h-2 rounded-full bg-slate-500";
    lbl.innerText = "Grabar CSV";
    downloadCsv();
  }
}

function captureCsvRow() {
  const latest = activeTransport?.latest || {};
  const row = { Timestamp: new Date().toISOString() };
  OBDCore.SENSOR_CATALOG.forEach((s) => {
    row[s.id] = latest[s.id] ? latest[s.id].value : "";
  });
  csvRows.push(row);
}

function downloadCsv() {
  if (!csvRows.length) return showConnAlert("No se grabaron muestras para exportar.", "info");
  const headers = Object.keys(csvRows[0]);
  const lines = [headers.join(",")];
  for (const r of csvRows) {
    lines.push(headers.map((h) => r[h]).join(","));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  a.href = url;
  a.download = `obd2_musso_${stamp}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showConnAlert(`CSV descargado (${csvRows.length} muestras).`, "success");
}

// =========================================================
// NAVEGACIÓN PRINCIPAL
// =========================================================
async function switchMainTab(tab) {
  activeTab = tab;
  ["post_assembly", "all_sensors", "custom_views"].forEach((t) => {
    document.getElementById(`tab_${t}`).classList.toggle("hidden", t !== tab);
    const btn = document.getElementById(`nav_${t}`);
    btn.className = t === tab
      ? "px-3.5 py-2 rounded-xl text-xs sm:text-sm font-bold whitespace-nowrap transition bg-sky-500 text-slate-950 shadow"
      : "px-3.5 py-2 rounded-xl text-xs sm:text-sm font-bold whitespace-nowrap transition text-slate-300 hover:bg-slate-800 bg-slate-900/60";
  });
  if (tab === "custom_views") renderActiveCustomView();
  if (transportType === "wifi" && activeTransport) {
    await activeTransport.setWatch(getWatchIdsForActiveTab());
  }
}

// =========================================================
// TAB 1: VISOR POST-ARMADO (FALLAS + COOLANT + ADMISIÓN)
// =========================================================
async function scanDTCs() {
  const container = document.getElementById("dtcContainer");
  if (!activeTransport) {
    container.innerHTML = `<div class="text-xs text-amber-300 p-4 text-center bg-amber-950/20 border border-amber-500/30 rounded-xl">Conectá primero por Bluetooth BLE, USB Serial, Wi-Fi Bridge o Simulador Demo.</div>`;
    return;
  }
  container.innerHTML = `<div class="text-xs text-sky-300 p-4 text-center">Consultando ECU (Modos 0101, 03, 07, 0A y Freeze Frame 02)...</div>`;
  const res = await activeTransport.readDTCs();
  if (!res.ok) {
    container.innerHTML = `<div class="text-xs text-red-300 bg-red-950/40 border border-red-500/30 rounded-xl p-4">${res.error}</div>`;
    return;
  }

  const milBadge = res.mil_on
    ? `<span class="px-2.5 py-1 rounded-lg bg-red-500/20 border border-red-500/40 text-red-300 font-bold text-xs">⚠️ Check Engine (MIL): ENCENDIDO</span>`
    : `<span class="px-2.5 py-1 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-bold text-xs">✅ Check Engine (MIL): APAGADO</span>`;

  const renderList = (title, items, badgeClass) => {
    if (!items || !items.length) {
      return `
        <div class="bg-slate-950/60 border border-slate-800 rounded-xl p-3">
          <div class="text-xs font-bold text-slate-300 mb-1">${title}</div>
          <div class="text-xs text-emerald-400">Sin códigos detectados (Limpio)</div>
        </div>`;
    }
    return `
      <div class="bg-slate-950/60 border border-red-500/30 rounded-xl p-3 space-y-2">
        <div class="text-xs font-bold text-red-300">${title} (${items.length})</div>
        ${items.map((c) => `
          <div class="p-2 rounded-lg bg-slate-900 border border-slate-800">
            <span class="px-1.5 py-0.5 rounded text-xs font-mono font-black ${badgeClass}">${c.code}</span>
            <p class="text-xs text-slate-300 mt-1">${c.description}</p>
          </div>`).join("")}
      </div>`;
  };

  let monitorsHtml = "";
  if (res.monitors && Object.keys(res.monitors).length) {
    monitorsHtml = `
      <div class="mt-3 flex flex-wrap gap-2">
        ${Object.entries(res.monitors).map(([k, v]) => `
          <span class="px-2.5 py-1 rounded-lg text-[11px] font-mono border ${v === "OK" ? "bg-emerald-950/40 border-emerald-500/30 text-emerald-300" : "bg-amber-950/40 border-amber-500/30 text-amber-300"}">
            ${k.toUpperCase()}: ${v}
          </span>`).join("")}
      </div>`;
  }

  let ffHtml = "";
  if (res.freeze_frame) {
    ffHtml = `
      <div class="mt-3 bg-amber-950/20 border border-amber-500/30 rounded-xl p-3">
        <div class="text-xs font-bold text-amber-300 mb-2">📦 Caja Negra (Freeze Frame - DTC: ${res.freeze_frame.dtc})</div>
        <div class="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
          ${Object.entries(res.freeze_frame.params || {}).map(([k, v]) => `
            <div class="bg-slate-950/80 p-2 rounded-lg border border-slate-800">
              <div class="text-[10px] text-slate-400">${k}</div>
              <div class="font-bold font-mono text-white">${v}</div>
            </div>`).join("")}
        </div>
      </div>`;
  }

  container.innerHTML = `
    <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
      ${milBadge}
      ${res.note ? `<span class="text-xs text-sky-300">${res.note}</span>` : ""}
    </div>
    <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
      ${renderList("Confirmados (Modo 03)", res.confirmed, "bg-red-500/20 text-red-300")}
      ${renderList("Pendientes Ciclo Actual (Modo 07)", res.pending, "bg-amber-500/20 text-amber-300")}
      ${renderList("Permanentes (Modo 0A)", res.permanent, "bg-purple-500/20 text-purple-300")}
    </div>
    ${monitorsHtml}
    ${ffHtml}
  `;
}

async function clearDTCs(force = false) {
  if (!activeTransport) return showConnAlert("Conectá un adaptador primero.", "error");
  const res = await activeTransport.clearDTCs(force);
  if (res.ok) {
    showConnAlert(res.message, "success");
    await scanDTCs();
  } else {
    showConnAlert(res.error || "Error al borrar códigos", "error");
  }
}

function renderPostAssemblySkeleton() {
  const thermalMinis = ["0167", "015C", "016B", "010F", "0177", "0146"];
  document.getElementById("thermalMiniGrid").innerHTML = thermalMinis.map((id) => {
    const s = OBDCore.CATALOG_BY_ID[id];
    return `
      <div id="pa_card_${id}" class="bg-slate-950/70 border border-slate-800 rounded-xl p-3">
        <div class="text-[11px] text-slate-400 truncate" title="${s.name}">${s.short}</div>
        <div class="mt-1 flex items-baseline gap-1">
          <span id="pa_val_${id}" class="text-xl font-black font-mono text-white">--</span>
          <span class="text-xs text-slate-400">${s.unit}</span>
        </div>
      </div>`;
  }).join("");

  const intakeAndLevels = [
    "010B", "0133", "0170_CMD", "0170_ACT", "0171",
    "0110", "012C", "012D", "0111", "010C",
    "0123", "0149", "ATRV", "0142", "012F", "011F", "017A",
  ];
  document.getElementById("intakeLevelsGrid").innerHTML = intakeAndLevels.map((id) => {
    const s = OBDCore.CATALOG_BY_ID[id];
    return `
      <div id="pa_card_${id}" class="bg-slate-950/70 border border-slate-800 rounded-xl p-3 transition-colors">
        <div class="flex justify-between items-center gap-1">
          <span class="text-[11px] text-slate-400 font-medium truncate" title="${s.description}">${s.short}</span>
          <span class="text-[10px] font-mono text-slate-600">${s.pid}</span>
        </div>
        <div class="mt-1 flex items-baseline gap-1">
          <span id="pa_val_${id}" class="text-xl font-black font-mono text-white">--</span>
          <span class="text-xs text-slate-400">${s.unit}</span>
        </div>
      </div>`;
  }).join("");
}

function updatePostAssemblyUI() {
  const latest = activeTransport?.latest || {};
  const history = activeTransport?.history || {};

  const ect = latest["0105"];
  if (ect) {
    const v = ect.value;
    document.getElementById("val_0105").innerText = v;
    const bar = document.getElementById("coolantBar");
    const tag = document.getElementById("coolantStatusTag");
    const phase = document.getElementById("thermalPhasePill");
    const card = document.getElementById("coolantMainCard");
    bar.style.width = `${Math.min(100, Math.max(0, (v / 115) * 100))}%`;

    if (v >= 103) {
      bar.className = "h-full bg-red-500 transition-all duration-300";
      tag.className = "px-2 py-0.5 rounded text-[11px] font-bold bg-red-500/20 text-red-300";
      tag.innerText = "CRÍTICO";
      phase.className = "px-3 py-1 rounded-full text-xs font-bold bg-red-500/20 text-red-300 border border-red-500/40";
      phase.innerText = "🔥 ALERTA SOBRETEMPERATURA — Revisar aire o electroventilador";
      card.className = "bg-red-950/30 border border-red-500 rounded-2xl p-4 flex flex-col justify-between";
    } else if (v >= 96) {
      bar.className = "h-full bg-amber-400 transition-all duration-300";
      tag.className = "px-2 py-0.5 rounded text-[11px] font-bold bg-amber-500/20 text-amber-300";
      tag.innerText = "ALTO";
      phase.className = "px-3 py-1 rounded-full text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40";
      phase.innerText = "⚠️ Vigilancia Térmica (>96°C)";
      card.className = "bg-amber-950/20 border border-amber-500/60 rounded-2xl p-4 flex flex-col justify-between";
    } else if (v >= 80) {
      bar.className = "h-full bg-emerald-400 transition-all duration-300";
      tag.className = "px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-500/20 text-emerald-300";
      tag.innerText = "ÓPTIMO";
      phase.className = "px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40";
      phase.innerText = "✅ Régimen Normal / Termostato Abierto (80-95°C)";
      card.className = "bg-slate-950/80 border border-emerald-500/30 rounded-2xl p-4 flex flex-col justify-between";
    } else {
      bar.className = "h-full bg-sky-400 transition-all duration-300";
      tag.className = "px-2 py-0.5 rounded text-[11px] font-bold bg-sky-500/20 text-sky-300";
      tag.innerText = "CALENTANDO";
      phase.className = "px-3 py-1 rounded-full text-xs font-bold bg-sky-500/20 text-sky-300 border border-sky-500/40";
      phase.innerText = "🌡️ Calentamiento y Purgado (<80°C)";
      card.className = "bg-slate-950/80 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between";
    }
  }

  POST_ASSEMBLY_WATCH_IDS.forEach((id) => {
    if (id === "0105") return;
    const valEl = document.getElementById(`pa_val_${id}`);
    const cardEl = document.getElementById(`pa_card_${id}`);
    const entry = latest[id];
    if (!valEl || !cardEl || !entry) return;
    valEl.innerText = entry.value;
    const status = evaluateAlert(OBDCore.CATALOG_BY_ID[id], entry.value);
    if (status === "crit") {
      cardEl.className = "bg-red-950/30 border border-red-500/60 rounded-xl p-3";
      valEl.className = "text-xl font-black font-mono text-red-400";
    } else if (status === "warn") {
      cardEl.className = "bg-amber-950/20 border border-amber-500/50 rounded-xl p-3";
      valEl.className = "text-xl font-black font-mono text-amber-300";
    } else {
      cardEl.className = "bg-slate-950/70 border border-slate-800 rounded-xl p-3";
      valEl.className = "text-xl font-black font-mono text-white";
    }
  });

  if (latest["010B"]) {
    const baro = latest["0133"] ? latest["0133"].value : 100;
    const boost = ((latest["010B"].value - baro) / 100).toFixed(2);
    document.getElementById("boostDeltaPill").innerText = `Boost Neto: ${boost >= 0 ? "+" : ""}${boost} bar`;
  }

  drawMultiSeriesChart(document.getElementById("thermalChart"), history, [
    { id: "0105", color: "#38bdf8" },
    { id: "016B", color: "#fbbf24" },
    { id: "015C", color: "#34d399" },
  ]);
}

function evaluateAlert(meta, val) {
  if (!meta || val === null || val === undefined) return "ok";
  if (meta.crit_high !== undefined && val >= meta.crit_high) return "crit";
  if (meta.crit_low !== undefined && val <= meta.crit_low) return "crit";
  if (meta.warn_high !== undefined && val >= meta.warn_high) return "warn";
  if (meta.warn_low !== undefined && val <= meta.warn_low) return "warn";
  return "ok";
}

// =========================================================
// CHECKLIST
// =========================================================
function renderChecklist() {
  const saved = JSON.parse(localStorage.getItem("musso_post_checklist") || "{}");
  document.getElementById("checklistGrid").innerHTML = CHECKLIST_ITEMS.map((item) => {
    const checked = !!saved[item.id];
    return `
      <label class="flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition ${checked ? "bg-emerald-950/20 border-emerald-500/40 text-emerald-200" : "bg-slate-950/60 border-slate-800 text-slate-300 hover:border-slate-700"}">
        <input type="checkbox" ${checked ? "checked" : ""} onchange="toggleCheckItem('${item.id}', this.checked)" class="mt-0.5 accent-emerald-400 w-4 h-4 rounded" />
        <span class="${checked ? "line-through opacity-80" : ""}">${item.text}</span>
      </label>`;
  }).join("");
}

function toggleCheckItem(id, checked) {
  const saved = JSON.parse(localStorage.getItem("musso_post_checklist") || "{}");
  saved[id] = checked;
  localStorage.setItem("musso_post_checklist", JSON.stringify(saved));
  renderChecklist();
}

function resetChecklist() {
  localStorage.removeItem("musso_post_checklist");
  renderChecklist();
}

// =========================================================
// TAB 2: EXPLORADOR COMPLETO
// =========================================================
function renderCategoryPills() {
  const pills = [{ id: "all", name: "Todos", icon: "📋" }, ...OBDCore.CATEGORIES];
  document.getElementById("categoryPills").innerHTML = pills.map((c) => `
    <button onclick="setCategoryFilter('${c.id}')" class="px-3 py-1.5 rounded-xl text-xs font-bold transition ${activeCategoryFilter === c.id ? "bg-sky-500 text-slate-950" : "bg-slate-900 border border-slate-800 text-slate-300 hover:bg-slate-800"}">
      ${c.icon} ${c.name}
    </button>`).join("");
}

async function setCategoryFilter(catId) {
  activeCategoryFilter = catId;
  renderCategoryPills();
  renderAllSensors();
  if (transportType === "wifi" && activeTransport) {
    await activeTransport.setWatch(getWatchIdsForActiveTab());
  }
}

function getFilteredCatalog() {
  const q = (document.getElementById("sensorSearch")?.value || "").toLowerCase();
  const sup = new Set(getSupportedIds());
  return OBDCore.SENSOR_CATALOG.filter((s) => {
    if (!sup.has(s.id)) return false;
    if (activeCategoryFilter !== "all" && s.category !== activeCategoryFilter) return false;
    if (q && !s.name.toLowerCase().includes(q) && !s.short.toLowerCase().includes(q) && !s.id.toLowerCase().includes(q)) return false;
    return true;
  });
}

function renderAllSensors() {
  const latest = activeTransport?.latest || {};
  document.getElementById("allSensorsGrid").innerHTML = getFilteredCatalog().map((s) => {
    const entry = latest[s.id];
    return `
      <div class="glass-card rounded-xl p-4 flex flex-col justify-between gap-2">
        <div>
          <div class="flex items-start justify-between gap-2">
            <span class="text-xs font-bold text-white leading-snug">${s.name}</span>
            <button onclick="openQuickAdd('${s.id}')" class="shrink-0 px-2 py-0.5 rounded bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 text-[10px] font-bold border border-sky-500/30">+ Visor</button>
          </div>
          <p class="text-[11px] text-slate-400 mt-1 line-clamp-2">${s.description}</p>
        </div>
        <div class="pt-2 border-t border-slate-800/80 flex items-end justify-between">
          <div class="flex items-baseline gap-1">
            <span id="all_val_${s.id}" class="text-2xl font-black font-mono text-emerald-400">${entry ? entry.value : "--"}</span>
            <span class="text-xs text-slate-400">${s.unit}</span>
          </div>
          <span id="all_raw_${s.id}" class="text-[10px] font-mono text-slate-500">${entry?.raw ? "HEX: " + entry.raw : "PID " + s.pid}</span>
        </div>
      </div>`;
  }).join("");
}

function updateAllSensorsValues() {
  const latest = activeTransport?.latest || {};
  getFilteredCatalog().forEach((s) => {
    const entry = latest[s.id];
    if (!entry) return;
    const valEl = document.getElementById(`all_val_${s.id}`);
    const rawEl = document.getElementById(`all_raw_${s.id}`);
    if (valEl) valEl.innerText = entry.value;
    if (rawEl && entry.raw) rawEl.innerText = `HEX: ${entry.raw}`;
  });
}

async function scanAllSensors() {
  if (!activeTransport) return showConnAlert("Conectá un adaptador primero.", "error");
  const btn = document.getElementById("btnScanAll");
  btn.innerText = "⏳ Leyendo todos...";
  btn.disabled = true;
  if (transportType === "wifi") {
    const res = await activeTransport.scanAll();
    if (res.ok && res.data) activeTransport.latest = res.data.latest || {};
  } else {
    await activeTransport.pollIds(getSupportedIds());
  }
  btn.innerText = "⚡ Barrido Completo (Leer Todos)";
  btn.disabled = false;
  updateAllSensorsValues();
  showConnAlert(`Barrido completado: ${Object.keys(activeTransport.latest).length} sensores leídos.`, "success");
}

// =========================================================
// TAB 3: VISORES CUSTOM (PERSISTIDOS EN LOCALSTORAGE)
// =========================================================
function loadCustomViews() {
  try {
    const saved = JSON.parse(localStorage.getItem("obd2_custom_views") || "null");
    customViews = Array.isArray(saved) && saved.length ? saved : JSON.parse(JSON.stringify(DEFAULT_CUSTOM_VIEWS));
  } catch (_) {
    customViews = JSON.parse(JSON.stringify(DEFAULT_CUSTOM_VIEWS));
  }
  if (customViews.length && !activeCustomViewId) activeCustomViewId = customViews[0].id;
  document.getElementById("viewsCountBadge").innerText = customViews.length;
  renderCustomViewTabs();
}

function saveCustomViews() {
  localStorage.setItem("obd2_custom_views", JSON.stringify(customViews));
  document.getElementById("viewsCountBadge").innerText = customViews.length;
}

function renderCustomViewTabs() {
  document.getElementById("customViewTabs").innerHTML = customViews.map((v) => `
    <button onclick="selectCustomView('${v.id}')" class="px-3.5 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${v.id === activeCustomViewId ? "bg-emerald-500 text-slate-950 shadow" : "bg-slate-900 border border-slate-800 text-slate-300 hover:bg-slate-800"}">
      <span>${v.icon || "🎛️"}</span>
      <span>${v.name}</span>
      <span class="opacity-70 font-mono text-[10px]">(${v.widgets.length})</span>
    </button>`).join("");
  if (activeTab === "custom_views") renderActiveCustomView();
}

async function selectCustomView(id) {
  activeCustomViewId = id;
  renderCustomViewTabs();
  if (transportType === "wifi" && activeTransport) {
    await activeTransport.setWatch(getWatchIdsForActiveTab());
  }
}

function renderActiveCustomView() {
  const view = customViews.find((v) => v.id === activeCustomViewId);
  const header = document.getElementById("activeCustomViewHeader");
  const container = document.getElementById("customViewWidgets");

  if (!view) {
    header.classList.add("hidden");
    container.innerHTML = `<div class="col-span-full text-center text-xs text-slate-400 p-8 glass-card rounded-2xl">No hay visores custom. Presioná "+ Nuevo Visor Custom" para armar uno.</div>`;
    return;
  }

  header.classList.remove("hidden");
  document.getElementById("cvTitle").innerText = `${view.icon || ""} ${view.name}`;
  document.getElementById("cvDesc").innerText = view.description || "";

  container.innerHTML = view.widgets.map((w, idx) => {
    const meta = OBDCore.CATALOG_BY_ID[w.sensor_id] || { id: w.sensor_id, name: w.sensor_id, pid: w.sensor_id, unit: "", min: 0, max: 100 };
    if (w.type === "chart") {
      return `
        <div class="glass-card rounded-2xl p-4 md:col-span-2 flex flex-col justify-between">
          <div class="flex justify-between items-center mb-2">
            <div><span class="text-xs font-bold text-white">${meta.name}</span><span class="text-[10px] font-mono text-slate-500 ml-2">${meta.pid}</span></div>
            <div class="flex items-baseline gap-1"><span id="cv_val_${idx}" class="text-2xl font-black font-mono text-sky-400">--</span><span class="text-xs text-slate-400">${meta.unit}</span></div>
          </div>
          <div class="h-36 w-full bg-slate-950/70 rounded-xl p-1 border border-slate-800"><canvas id="cv_canvas_${idx}" class="w-full h-full"></canvas></div>
        </div>`;
    }
    if (w.type === "gauge") {
      return `
        <div class="glass-card rounded-2xl p-4 flex flex-col justify-between">
          <div class="flex justify-between items-start"><span class="text-xs font-bold text-slate-300">${meta.name}</span><span class="text-[10px] font-mono text-slate-500">${meta.pid}</span></div>
          <div class="my-3 flex items-baseline gap-1.5"><span id="cv_val_${idx}" class="text-3xl font-black font-mono text-white">--</span><span class="text-sm text-slate-400">${meta.unit}</span></div>
          <div>
            <div class="w-full h-2.5 bg-slate-800 rounded-full overflow-hidden"><div id="cv_bar_${idx}" class="h-full bg-emerald-400 transition-all duration-300" style="width: 0%"></div></div>
            <div class="flex justify-between text-[10px] font-mono text-slate-500 mt-1"><span>${meta.min ?? 0}</span><span>${meta.max ?? 100} ${meta.unit}</span></div>
          </div>
        </div>`;
    }
    return `
      <div class="glass-card rounded-2xl p-4 flex flex-col justify-between">
        <div class="flex justify-between items-start"><span class="text-xs font-bold text-slate-300">${meta.name}</span><span class="text-[10px] font-mono text-slate-500">${meta.pid}</span></div>
        <div class="mt-3 flex items-baseline gap-1.5"><span id="cv_val_${idx}" class="text-3xl font-black font-mono text-emerald-400">--</span><span class="text-sm text-slate-400">${meta.unit}</span></div>
      </div>`;
  }).join("");

  updateCustomViewValues();
}

function updateCustomViewValues() {
  const view = customViews.find((v) => v.id === activeCustomViewId);
  if (!view || !activeTransport) return;
  const latest = activeTransport.latest || {};
  const history = activeTransport.history || {};

  view.widgets.forEach((w, idx) => {
    const meta = OBDCore.CATALOG_BY_ID[w.sensor_id];
    const entry = latest[w.sensor_id];
    const valEl = document.getElementById(`cv_val_${idx}`);
    if (valEl && entry) {
      valEl.innerText = entry.value;
      const st = evaluateAlert(meta, entry.value);
      if (st === "crit") valEl.className = "text-3xl font-black font-mono text-red-400";
      else if (st === "warn") valEl.className = "text-3xl font-black font-mono text-amber-300";
    }
    if (w.type === "gauge" && entry && meta) {
      const bar = document.getElementById(`cv_bar_${idx}`);
      if (bar) {
        const min = meta.min ?? 0;
        const max = meta.max ?? 100;
        bar.style.width = `${Math.min(100, Math.max(0, ((entry.value - min) / (max - min)) * 100))}%`;
      }
    }
    if (w.type === "chart") {
      drawMultiSeriesChart(document.getElementById(`cv_canvas_${idx}`), history, [{ id: w.sensor_id, color: "#38bdf8" }]);
    }
  });
}

// =========================================================
// CONSTRUCTOR MODAL
// =========================================================
function openViewBuilder(viewToEdit) {
  editingViewId = viewToEdit ? viewToEdit.id : null;
  builderSelections = {};
  if (viewToEdit) {
    document.getElementById("builderModalTitle").innerText = "Editar Visor Custom";
    document.getElementById("vbName").value = viewToEdit.name;
    document.getElementById("vbDesc").value = viewToEdit.description || "";
    document.getElementById("vbIcon").value = viewToEdit.icon || "🌡️";
    viewToEdit.widgets.forEach((w) => (builderSelections[w.sensor_id] = w.type));
  } else {
    document.getElementById("builderModalTitle").innerText = "Crear Nuevo Visor Custom";
    document.getElementById("vbName").value = "";
    document.getElementById("vbDesc").value = "";
  }
  document.getElementById("vbFilter").value = "";
  renderBuilderSensorList();
  document.getElementById("builderModal").classList.remove("hidden");
}

function editActiveCustomView() {
  const v = customViews.find((x) => x.id === activeCustomViewId);
  if (v) openViewBuilder(v);
}

function closeViewBuilder() {
  document.getElementById("builderModal").classList.add("hidden");
}

function renderBuilderSensorList() {
  const q = (document.getElementById("vbFilter").value || "").toLowerCase();
  const sup = new Set(getSupportedIds());
  const list = OBDCore.SENSOR_CATALOG.filter((s) => sup.has(s.id) && (!q || s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q)));
  document.getElementById("vbSensorList").innerHTML = list.map((s) => {
    const selected = !!builderSelections[s.id];
    const wType = builderSelections[s.id] || "gauge";
    return `
      <div class="flex items-center justify-between gap-2 p-2 rounded-xl border ${selected ? "bg-sky-950/30 border-sky-500/40" : "bg-slate-950/60 border-slate-800"}">
        <label class="flex items-center gap-2 cursor-pointer flex-1">
          <input type="checkbox" ${selected ? "checked" : ""} onchange="toggleBuilderSensor('${s.id}', this.checked)" class="accent-sky-400 w-4 h-4" />
          <div>
            <div class="text-white font-semibold">${s.name} <span class="text-slate-500 font-mono">(${s.unit})</span></div>
            <div class="text-[10px] text-slate-400">${s.category} • PID ${s.pid}</div>
          </div>
        </label>
        <select onchange="changeBuilderWidgetType('${s.id}', this.value)" class="px-2 py-1 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 text-[11px]" ${selected ? "" : "disabled"}>
          <option value="gauge" ${wType === "gauge" ? "selected" : ""}>Barra / Gauge</option>
          <option value="chart" ${wType === "chart" ? "selected" : ""}>Gráfica Vivo</option>
          <option value="card" ${wType === "card" ? "selected" : ""}>Tarjeta</option>
        </select>
      </div>`;
  }).join("");
}

function toggleBuilderSensor(id, checked) {
  if (checked) builderSelections[id] = builderSelections[id] || "gauge";
  else delete builderSelections[id];
  renderBuilderSensorList();
}

function changeBuilderWidgetType(id, type) {
  if (builderSelections[id]) builderSelections[id] = type;
}

async function saveViewFromBuilder() {
  const name = document.getElementById("vbName").value.trim();
  if (!name) return alert("Ingresá un nombre para el visor.");
  const widgets = Object.entries(builderSelections).map(([sensor_id, type]) => ({ sensor_id, type }));
  if (!widgets.length) return alert("Seleccioná al menos un sensor.");

  const viewObj = {
    id: editingViewId || "cv_" + Date.now(),
    name,
    icon: document.getElementById("vbIcon").value,
    description: document.getElementById("vbDesc").value.trim(),
    widgets,
  };
  if (editingViewId) customViews = customViews.map((v) => (v.id === editingViewId ? viewObj : v));
  else customViews.push(viewObj);

  saveCustomViews();
  activeCustomViewId = viewObj.id;
  closeViewBuilder();
  renderCustomViewTabs();
  if (transportType === "wifi" && activeTransport) await activeTransport.setWatch(getWatchIdsForActiveTab());
}

function deleteActiveCustomView() {
  if (!confirm("¿Eliminar este visor personalizado?")) return;
  customViews = customViews.filter((v) => v.id !== activeCustomViewId);
  activeCustomViewId = customViews.length ? customViews[0].id : null;
  saveCustomViews();
  renderCustomViewTabs();
}

function openQuickAdd(sensorId) {
  quickAddTargetSensor = sensorId;
  const s = OBDCore.CATALOG_BY_ID[sensorId];
  document.getElementById("quickAddSensorName").innerText = `${s.name} (${s.pid})`;
  const sel = document.getElementById("quickAddViewSelect");
  sel.innerHTML = customViews.length
    ? customViews.map((v) => `<option value="${v.id}">${v.icon || ""} ${v.name}</option>`).join("")
    : `<option value="__new__">+ Crear Visor Nuevo</option>`;
  document.getElementById("quickAddModal").classList.remove("hidden");
}

function confirmQuickAdd() {
  const targetId = document.getElementById("quickAddViewSelect").value;
  const wType = document.getElementById("quickAddWidgetType").value;
  if (targetId === "__new__") {
    customViews.push({
      id: "cv_" + Date.now(),
      name: "Mi Visor Custom",
      icon: "🎛️",
      description: "Visor creado desde explorador",
      widgets: [{ sensor_id: quickAddTargetSensor, type: wType }],
    });
  } else {
    const v = customViews.find((x) => x.id === targetId);
    if (v && !v.widgets.some((w) => w.sensor_id === quickAddTargetSensor)) {
      v.widgets.push({ sensor_id: quickAddTargetSensor, type: wType });
    }
  }
  saveCustomViews();
  renderCustomViewTabs();
  document.getElementById("quickAddModal").classList.add("hidden");
  showConnAlert("Sensor agregado al visor custom.", "success");
}

// =========================================================
// GRÁFICAS CANVAS EN TIEMPO REAL
// =========================================================
function drawMultiSeriesChart(canvas, historyTelemetry, seriesList) {
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  const dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);

  const w = rect.width;
  const h = rect.height;
  ctx.clearRect(0, 0, w, h);

  const allVals = [];
  seriesList.forEach((s) => {
    (historyTelemetry[s.id] || []).forEach((pt) => {
      if (typeof pt.v === "number") allVals.push(pt.v);
    });
  });

  if (allVals.length < 2) {
    ctx.fillStyle = "#64748b";
    ctx.font = "11px monospace";
    ctx.textAlign = "center";
    ctx.fillText("Esperando muestras en vivo...", w / 2, h / 2);
    return;
  }

  let minV = Math.min(...allVals);
  let maxV = Math.max(...allVals);
  if (maxV - minV < 5) { minV -= 5; maxV += 5; }
  else { const pad = (maxV - minV) * 0.12; minV -= pad; maxV += pad; }

  const padL = 36, padR = 10, padT = 10, padB = 18;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  ctx.strokeStyle = "#1e293b";
  ctx.lineWidth = 1;
  ctx.fillStyle = "#64748b";
  ctx.font = "10px monospace";
  ctx.textAlign = "right";
  for (let i = 0; i <= 3; i++) {
    const y = padT + (plotH * i) / 3;
    const lbl = (maxV - ((maxV - minV) * i) / 3).toFixed(0);
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(w - padR, y);
    ctx.stroke();
    ctx.fillText(lbl, padL - 5, y + 3);
  }

  seriesList.forEach((s) => {
    const arr = historyTelemetry[s.id] || [];
    if (arr.length < 2) return;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    arr.forEach((pt, i) => {
      const x = padL + (i / (arr.length - 1)) * plotW;
      const y = padT + plotH - ((pt.v - minV) / (maxV - minV)) * plotH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  });
}

window.addEventListener("DOMContentLoaded", initApp);
