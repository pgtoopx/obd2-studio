/**
 * OBD2 Studio — Client-side SAE J1979 PID Catalog, Decoders, DTC & Freeze Frame Engine.
 * Runs 100% in the browser for Web Bluetooth, Web Serial, and Demo modes.
 */

(function (global) {
  const u8 = (b) => parseInt(b, 16);
  const u16 = (b1, b2) => (parseInt(b1, 16) << 8) + parseInt(b2, 16);

  const decLoad = (d) => Math.round((u8(d[0]) * 1000) / 255) / 10;
  const decTemp40 = (d) => u8(d[0]) - 40;
  const decU8 = (d) => u8(d[0]);
  const decRpm = (d) => Math.round(u16(d[0], d[1]) / 4);
  const decMaf = (d) => Math.round(u16(d[0], d[1])) / 100;
  const decPct = (d) => Math.round((u8(d[0]) * 1000) / 255) / 10;
  const decU16 = (d) => u16(d[0], d[1]);
  const decRail = (d) => Math.round((u16(d[0], d[1]) * 10) / 10) / 10; // kPa*10 -> bar
  const decEgrErr = (d) => Math.round(((u8(d[0]) - 128) * 1000) / 128) / 10;
  const decVolt = (d) => Math.round(u16(d[0], d[1]) / 10) / 100;
  const decFuelRate = (d) => Math.round(u16(d[0], d[1]) * 5) / 100;
  const decTorquePct = (d) => u8(d[0]) - 125;

  const decBoostCmd = (d) => (d.length >= 3 ? Math.round(u16(d[1], d[2]) * 0.03125 * 10) / 10 : null);
  const decBoostAct = (d) => (d.length >= 5 ? Math.round(u16(d[3], d[4]) * 0.03125 * 10) / 10 : null);
  const decVgtPos = (d) => {
    if (d.length < 3) return null;
    const v = u16(d[1], d[2]);
    return v <= 10000 ? Math.round(v * 0.1) / 10 : Math.round((u8(d[1]) * 1000) / 255) / 10;
  };
  const decDpfDeltaP = (d) => (d.length >= 3 ? Math.round(u16(d[1], d[2]) * 0.03125 * 100) / 10 : null);
  const decDpfTempIn = (d) => (d.length >= 3 ? Math.round((u16(d[1], d[2]) * 0.1 - 40) * 10) / 10 : null);
  const decDpfTempOut = (d) => (d.length >= 5 ? Math.round((u16(d[3], d[4]) * 0.1 - 40) * 10) / 10 : null);
  const decDpfSoot = (d) => (d.length >= 11 ? Math.round(u16(d[9], d[10]) * 0.01) / 10 : null);
  const decTemp6x = (d) => {
    if (d.length < 2) return null;
    for (let i = 1; i < Math.min(5, d.length); i++) {
      const v = u8(d[i]);
      if (v !== 0 && v !== 255) return v - 40;
    }
    return u8(d[1]) - 40;
  };
  const decEgt78 = (d) => (d.length >= 3 ? Math.round((u16(d[1], d[2]) * 0.1 - 40) * 10) / 10 : null);

  const CATEGORIES = [
    { id: "cooling", name: "Refrigerante y Temperaturas", icon: "🌡️" },
    { id: "intake_boost", name: "Admisión, Turbo y EGR", icon: "🌀" },
    { id: "electrical_levels", name: "Niveles, Voltaje y Tiempos", icon: "🔋" },
    { id: "fuel_engine", name: "Motor e Inyección", icon: "⚙️" },
    { id: "dpf_exhaust", name: "DPF y Escape", icon: "🛡️" },
  ];

  const SENSOR_CATALOG = [
    { id: "0105", pid: "0105", name: "Temp. Refrigerante (ECT)", short: "Refrigerante", unit: "°C", category: "cooling", min: -20, max: 120, warn_high: 96, crit_high: 103, description: "Temperatura principal del líquido refrigerante. Vital para verificar purgado sin burbujas y apertura de termostato (~82-88°C).", decoder: decTemp40, min_bytes: 1 },
    { id: "0167", pid: "0167", name: "Temp. Refrigerante Sensor 2", short: "ECT Auxiliar", unit: "°C", category: "cooling", min: -20, max: 120, warn_high: 96, crit_high: 103, description: "Lectura de sensor de temperatura de refrigerante extendido (PID 67).", decoder: (d) => (d.length >= 2 ? u8(d[1]) - 40 : null), min_bytes: 2 },
    { id: "015C", pid: "015C", name: "Temp. Aceite Motor", short: "Aceite", unit: "°C", category: "cooling", min: -20, max: 140, warn_high: 115, crit_high: 125, description: "Temperatura del aceite del motor. Debe subir progresivamente detrás del refrigerante.", decoder: decTemp40, min_bytes: 1 },
    { id: "016B", pid: "016B", name: "Temp. Gases EGR (Enfriador)", short: "Temp EGR", unit: "°C", category: "cooling", min: -20, max: 450, warn_high: 320, crit_high: 400, description: "Temperatura de recirculación EGR. Si el enfriador EGR tiene aire atrapado tras vaciar coolant, puede dispararse.", decoder: decTemp6x, min_bytes: 2 },
    { id: "010F", pid: "010F", name: "Temp. Aire Admisión (IAT)", short: "Aire Admisión", unit: "°C", category: "cooling", min: -20, max: 100, warn_high: 65, crit_high: 80, description: "Temperatura del aire entrando al motor. Confirma que el sensor IAT quedó conectado y leyendo coherente.", decoder: decTemp40, min_bytes: 1 },
    { id: "0168", pid: "0168", name: "Temp. Aire Admisión Sensor 2", short: "IAT Múltiple", unit: "°C", category: "cooling", min: -20, max: 100, warn_high: 65, crit_high: 80, description: "Sensor secundario de temperatura de aire de admisión (PID 68).", decoder: (d) => (d.length >= 2 ? u8(d[1]) - 40 : null), min_bytes: 2 },
    { id: "0177", pid: "0177", name: "Temp. Post-Intercooler (CAC)", short: "Intercooler", unit: "°C", category: "cooling", min: -20, max: 120, warn_high: 75, crit_high: 90, description: "Temperatura del aire a la salida del intercooler.", decoder: decTemp6x, min_bytes: 2 },
    { id: "0175", pid: "0175", name: "Temp. Turbocompresor", short: "Temp Turbo", unit: "°C", category: "cooling", min: -20, max: 900, warn_high: 750, crit_high: 850, description: "Temperatura medida en carcasa o zona de turbo.", decoder: decTemp6x, min_bytes: 2 },
    { id: "0146", pid: "0146", name: "Temp. Aire Ambiente", short: "Ambiente", unit: "°C", category: "cooling", min: -30, max: 60, description: "Temperatura exterior medida por el vehículo.", decoder: decTemp40, min_bytes: 1 },

    { id: "010B", pid: "010B", name: "Presión Múltiple (MAP)", short: "MAP Absoluta", unit: "kPa", category: "intake_boost", min: 20, max: 280, warn_low: 80, description: "Presión absoluta en la admisión. Con motor apagado debe igualar la barométrica (~100 kPa).", decoder: decU8, min_bytes: 1 },
    { id: "0133", pid: "0133", name: "Presión Barométrica", short: "Baro", unit: "kPa", category: "intake_boost", min: 60, max: 110, description: "Presión atmosférica local de referencia.", decoder: decU8, min_bytes: 1 },
    { id: "0170_CMD", pid: "0170", name: "Turbo Solicitado (Objetivo ECU)", short: "Turbo Cmd", unit: "kPa", category: "intake_boost", min: 80, max: 280, description: "Presión de sobrealimentación exigida por la computadora.", decoder: decBoostCmd, min_bytes: 3 },
    { id: "0170_ACT", pid: "0170", name: "Turbo Real (Medido)", short: "Turbo Act", unit: "kPa", category: "intake_boost", min: 80, max: 280, description: "Presión real medida en el sistema de sobrealimentación.", decoder: decBoostAct, min_bytes: 5 },
    { id: "0171", pid: "0171", name: "Comando Geometría Turbo (VGT)", short: "Actuador VGT", unit: "%", category: "intake_boost", min: 0, max: 100, description: "Posición comandada al actuador electrónico de geometría variable.", decoder: decVgtPos, min_bytes: 3 },
    { id: "0110", pid: "0110", name: "Flujo Masa de Aire (MAF)", short: "MAF", unit: "g/s", category: "intake_boost", min: 0, max: 250, description: "Caudal de aire entrando por el filtro. Ralentí ~7-11 g/s.", decoder: decMaf, min_bytes: 2 },
    { id: "012C", pid: "012C", name: "EGR Comandada", short: "EGR Cmd", unit: "%", category: "intake_boost", min: 0, max: 100, description: "Apertura ordenada a la válvula EGR tras armar la admisión.", decoder: decPct, min_bytes: 1 },
    { id: "012D", pid: "012D", name: "Error de Posición EGR", short: "Error EGR", unit: "%", category: "intake_boost", min: -100, max: 100, warn_high: 15, warn_low: -15, description: "Desvío entre apertura EGR ordenada y real. Cercano a 0% indica montaje sano.", decoder: decEgrErr, min_bytes: 1 },
    { id: "0111", pid: "0111", name: "Posición Mariposa Admisión", short: "Mariposa", unit: "%", category: "intake_boost", min: 0, max: 100, description: "Apertura de la mariposa de admisión.", decoder: decPct, min_bytes: 1 },
    { id: "014C", pid: "014C", name: "Actuador Mariposa Comandado", short: "Cmd Mariposa", unit: "%", category: "intake_boost", min: 0, max: 100, description: "Orden enviada al cuerpo de mariposa en la admisión.", decoder: decPct, min_bytes: 1 },

    { id: "ATRV", pid: "ATRV", name: "Voltaje Batería (OBD Pin 16)", short: "Batería OBD", unit: "V", category: "electrical_levels", min: 10, max: 16, warn_low: 12.1, crit_low: 11.6, warn_high: 15.0, description: "Voltaje en el puerto OBD2. Motor en marcha ~13.8-14.5V.", decoder: null, min_bytes: 0 },
    { id: "0142", pid: "0142", name: "Voltaje Módulo Control (ECU)", short: "Voltaje ECU", unit: "V", category: "electrical_levels", min: 10, max: 16, warn_low: 12.0, warn_high: 15.0, description: "Voltaje interno medido por la computadora del motor.", decoder: decVolt, min_bytes: 2 },
    { id: "012F", pid: "012F", name: "Nivel de Combustible", short: "Combustible", unit: "%", category: "electrical_levels", min: 0, max: 100, warn_low: 12, description: "Nivel porcentual de combustible en el estanque.", decoder: decPct, min_bytes: 1 },
    { id: "011F", pid: "011F", name: "Tiempo Motor Encendido", short: "Tiempo Marcha", unit: "s", category: "electrical_levels", min: 0, max: 65535, description: "Segundos transcurridos desde el último arranque.", decoder: decU16, min_bytes: 2 },
    { id: "0121", pid: "0121", name: "Distancia con Check Engine (MIL)", short: "Dist. MIL", unit: "km", category: "electrical_levels", min: 0, max: 65535, description: "Kilómetros recorridos con testigo MIL encendido.", decoder: decU16, min_bytes: 2 },
    { id: "0131", pid: "0131", name: "Distancia desde Borrado DTCs", short: "Dist. Borrado", unit: "km", category: "electrical_levels", min: 0, max: 65535, description: "Kilómetros recorridos desde el último reseteo de fallas.", decoder: decU16, min_bytes: 2 },

    { id: "010C", pid: "010C", name: "Revoluciones del Motor", short: "RPM", unit: "RPM", category: "fuel_engine", min: 0, max: 5000, warn_high: 4200, description: "Velocidad de giro del cigüeñal.", decoder: decRpm, min_bytes: 2 },
    { id: "010D", pid: "010D", name: "Velocidad del Vehículo", short: "Velocidad", unit: "km/h", category: "fuel_engine", min: 0, max: 220, description: "Velocidad de desplazamiento en ruta.", decoder: decU8, min_bytes: 1 },
    { id: "0104", pid: "0104", name: "Carga Calculada del Motor", short: "Carga Motor", unit: "%", category: "fuel_engine", min: 0, max: 100, description: "Porcentaje de carga demandada al motor.", decoder: decLoad, min_bytes: 1 },
    { id: "0149", pid: "0149", name: "Posición Pedal Acelerador (D)", short: "Pedal", unit: "%", category: "fuel_engine", min: 0, max: 100, description: "Posición del sensor de pedal.", decoder: decPct, min_bytes: 1 },
    { id: "0123", pid: "0123", name: "Presión Riel Combustible", short: "Riel Diésel", unit: "bar", category: "fuel_engine", min: 0, max: 2200, warn_low: 200, description: "Presión Common Rail (~250-300 bar en ralentí).", decoder: decRail, min_bytes: 2 },
    { id: "015E", pid: "015E", name: "Consumo Instantáneo Combustible", short: "Caudal L/h", unit: "L/h", category: "fuel_engine", min: 0, max: 60, description: "Tasa de consumo por hora.", decoder: decFuelRate, min_bytes: 2 },
    { id: "0162", pid: "0162", name: "Torque Actual Motor", short: "Torque %", unit: "%", category: "fuel_engine", min: -50, max: 120, description: "Porcentaje de torque actual.", decoder: decTorquePct, min_bytes: 1 },
    { id: "0163", pid: "0163", name: "Torque de Referencia Motor", short: "Torque Ref", unit: "Nm", category: "fuel_engine", min: 0, max: 800, description: "Torque nominal máximo configurado en ECU.", decoder: decU16, min_bytes: 2 },

    { id: "017A", pid: "017A", name: "Presión Diferencial DPF", short: "DPF Delta-P", unit: "mbar", category: "dpf_exhaust", min: 0, max: 400, warn_high: 40, crit_high: 80, description: "Contrapresión a través del DPF. Ralentí sano < 15 mbar.", decoder: decDpfDeltaP, min_bytes: 3 },
    { id: "017C_IN", pid: "017C", name: "Temp. Entrada DPF (EGT)", short: "EGT Entrada", unit: "°C", category: "dpf_exhaust", min: 0, max: 800, warn_high: 680, description: "Temperatura antes del filtro DPF.", decoder: decDpfTempIn, min_bytes: 3 },
    { id: "017C_OUT", pid: "017C", name: "Temp. Salida DPF (EGT)", short: "EGT Salida", unit: "°C", category: "dpf_exhaust", min: 0, max: 800, warn_high: 680, description: "Temperatura a la salida del DPF.", decoder: decDpfTempOut, min_bytes: 5 },
    { id: "018C", pid: "018C", name: "Saturación de Hollín DPF", short: "Hollín DPF", unit: "%", category: "dpf_exhaust", min: 0, max: 120, warn_high: 85, crit_high: 100, description: "Carga estimada de hollín acumulado.", decoder: decDpfSoot, min_bytes: 11 },
    { id: "0178", pid: "0178", name: "Temp. Gases Escape Banco 1", short: "EGT B1S1", unit: "°C", category: "dpf_exhaust", min: 0, max: 900, warn_high: 750, description: "Sensor primario de temperatura de escape.", decoder: decEgt78, min_bytes: 3 },
  ];

  const DTC_DESCRIPTIONS = {
    P00AF: "Actuador de Control de Presión de Turbo 'A' - Rendimiento / Trabado",
    P0299: "Turbo / Supercargador - Presión de Sobrealimentación Baja (Underboost)",
    P0234: "Turbo / Supercargador - Sobrepresión (Overboost)",
    P0100: "Circuito de Sensor de Flujo de Masa de Aire (MAF) - Falla",
    P0101: "Sensor MAF - Rango / Rendimiento",
    P0102: "Sensor MAF - Señal Baja (¿Desconectado o cableado?)",
    P0103: "Sensor MAF - Señal Alta",
    P0105: "Circuito de Sensor MAP - Falla",
    P0106: "Sensor MAP / Barométrico - Rango / Rendimiento",
    P0107: "Sensor MAP - Señal Baja",
    P0108: "Sensor MAP - Señal Alta",
    P0110: "Sensor Temperatura Aire Admisión (IAT) - Falla Circuito",
    P0112: "Sensor IAT - Señal Baja",
    P0113: "Sensor IAT - Señal Alta (¿Desconectado tras rearmado?)",
    P0115: "Sensor Temperatura Refrigerante (ECT) - Falla Circuito",
    P0116: "Sensor ECT - Rango / Rendimiento",
    P0117: "Sensor ECT - Señal Baja (Temperatura muy alta o corto)",
    P0118: "Sensor ECT - Señal Alta (¿Sensor desconectado?)",
    P0128: "Termostato Refrigerante - Temperatura por debajo del umbral",
    P0217: "Condición de Sobretemperatura del Motor",
    P0400: "Flujo EGR - Falla",
    P0401: "EGR - Flujo Insuficiente",
    P0402: "EGR - Flujo Excesivo (¿Válvula quedó abierta?)",
    P0403: "Circuito Control Válvula EGR - Falla Eléctrica",
    P0404: "EGR - Rango / Rendimiento Control",
    P0405: "Sensor Posición EGR 'A' - Señal Baja",
    P0406: "Sensor Posición EGR 'A' - Señal Alta",
    P2002: "Eficiencia DPF por debajo del umbral",
    P2452: "Sensor Presión Diferencial DPF - Falla Circuito",
    P2453: "Sensor Presión Diferencial DPF - Rango / Rendimiento",
    P2463: "Filtro DPF - Acumulación de Hollín",
    P2263: "Sistema de Sobrealimentación - Rendimiento",
    P0087: "Presión Riel Combustible Demasiado Baja",
    P0088: "Presión Riel Combustible Demasiado Alta",
    P0562: "Voltaje del Sistema Bajo",
    P0563: "Voltaje del Sistema Alto",
    U0100: "Pérdida de Comunicación con ECM/PCM",
  };

  function describeDtc(code) {
    if (DTC_DESCRIPTIONS[code]) return DTC_DESCRIPTIONS[code];
    const p = code[0];
    if (p === "P") return "Código de Tren Motriz (Powertrain) OBD-II";
    if (p === "C") return "Código de Chasis (ABS / ESP / Tracción)";
    if (p === "B") return "Código de Carrocería (BCM / SRS / Confort)";
    if (p === "U") return "Código de Red CAN Bus";
    return "Código de falla OBD-II";
  }

  function decodeDtcPair(b1Hex, b2Hex) {
    const b1 = parseInt(b1Hex, 16);
    const b2 = parseInt(b2Hex, 16);
    if (!b1 && !b2) return null;
    const prefix = ["P", "C", "B", "U"][(b1 & 0xc0) >> 6];
    const d1 = (b1 & 0x30) >> 4;
    const d2 = (b1 & 0x0f).toString(16).toUpperCase();
    return `${prefix}${d1}${d2}${b2.toString(16).toUpperCase().padStart(2, "0")}`;
  }

  function extractDataBytes(rawStr, expectedMode, expectedPidHex) {
    if (!rawStr || /NO DATA|ERROR|UNABLE|STOPPED/i.test(rawStr)) return [];
    const tokens = rawStr.replace(/[\r\n:]/g, " ").trim().split(/\s+/);
    const hexBytes = [];
    for (const t of tokens) {
      if (t.length === 2 && /^[0-9A-Fa-f]{2}$/.test(t)) {
        hexBytes.push(t.toUpperCase());
      }
    }
    const m = expectedMode.toUpperCase();
    const p = expectedPidHex.toUpperCase();
    for (let i = 0; i < hexBytes.length - 1; i++) {
      if (hexBytes[i] === m && hexBytes[i + 1] === p) {
        return hexBytes.slice(i + 2);
      }
    }
    return [];
  }

  function parseBitmaskPids(basePid, dataBytes) {
    const out = [];
    if (dataBytes.length < 4) return out;
    for (let byteIdx = 0; byteIdx < 4; byteIdx++) {
      const val = parseInt(dataBytes[byteIdx], 16);
      for (let bit = 0; bit < 8; bit++) {
        if (val & (1 << (7 - bit))) {
          const num = basePid + byteIdx * 8 + bit + 1;
          out.push("01" + num.toString(16).toUpperCase().padStart(2, "0"));
        }
      }
    }
    return out;
  }

  global.OBDCore = {
    CATEGORIES,
    SENSOR_CATALOG,
    CATALOG_BY_ID: Object.fromEntries(SENSOR_CATALOG.map((s) => [s.id, s])),
    describeDtc,
    decodeDtcPair,
    extractDataBytes,
    parseBitmaskPids,
  };
})(window);
