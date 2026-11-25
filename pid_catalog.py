"""
Catálogo completo de PIDs SAE J1979 / OBD-II y decodificadores
Optimizado para SsangYong Musso 2022 (2.2 e-XDi D22DTR) y vehículos CAN estándar.
"""

def u8(b):
    return int(b, 16)

def u16(b1, b2):
    return (int(b1, 16) << 8) + int(b2, 16)

def s16(b1, b2):
    val = u16(b1, b2)
    return val - 65536 if val >= 32768 else val

def parse_bitmask_pids(base_pid, data_bytes):
    """Decodifica respuestas 0100, 0120, 0140, 0160, 0180 en lista de PIDs hex soportados."""
    supported = []
    if len(data_bytes) < 4:
        return supported
    for byte_idx in range(4):
        val = int(data_bytes[byte_idx], 16)
        for bit in range(8):
            if val & (1 << (7 - bit)):
                pid_num = base_pid + (byte_idx * 8) + bit + 1
                supported.append(f"01{pid_num:02X}")
    return supported

def decode_dtc_pair(b1_hex, b2_hex):
    b1 = int(b1_hex, 16)
    b2 = int(b2_hex, 16)
    if b1 == 0 and b2 == 0:
        return None
    prefix = ["P", "C", "B", "U"][(b1 & 0xC0) >> 6]
    d1 = (b1 & 0x30) >> 4
    d2 = b1 & 0x0F
    return f"{prefix}{d1}{d2:X}{b2:02X}"

# Diccionario de descripciones técnicas para DTCs comunes (en especial SsangYong / Diésel)
DTC_DESCRIPTIONS = {
    "P00AF": "Actuador de Control de Presión de Turbo 'A' - Rendimiento del Módulo / Trabado",
    "P0299": "Turbo / Supercargador - Presión de Sobrealimentación Baja (Underboost)",
    "P0234": "Turbo / Supercargador - Condición de Sobrepresión (Overboost)",
    "P0100": "Circuito de Sensor de Flujo de Masa de Aire (MAF) - Falla",
    "P0101": "Sensor MAF - Problema de Rango / Rendimiento",
    "P0102": "Sensor MAF - Señal de Entrada Baja (¿Desconectado o cableado?)",
    "P0103": "Sensor MAF - Señal de Entrada Alta",
    "P0105": "Circuito de Sensor de Presión Absoluta del Múltiple (MAP)",
    "P0106": "Sensor MAP / Barométrico - Rango / Rendimiento",
    "P0107": "Sensor MAP - Señal Baja",
    "P0108": "Sensor MAP - Señal Alta",
    "P0110": "Sensor de Temperatura de Aire de Admisión (IAT) - Falla de Circuito",
    "P0112": "Sensor IAT - Señal Baja",
    "P0113": "Sensor IAT - Señal Alta (¿Desconectado tras rearmado?)",
    "P0115": "Sensor de Temperatura de Refrigerante (ECT) - Falla de Circuito",
    "P0116": "Sensor ECT - Rango / Rendimiento",
    "P0117": "Sensor ECT - Señal Baja (Temperatura muy alta o corto)",
    "P0118": "Sensor ECT - Señal Alta (¿Sensor desconectado o circuito abierto?)",
    "P0128": "Termostato de Refrigerante - Temperatura por debajo del umbral de regulación",
    "P0217": "Condición de Sobretemperatura del Motor",
    "P0400": "Flujo de Recirculación de Gases de Escape (EGR) - Falla",
    "P0401": "EGR - Flujo Insuficiente Detectado (¿Obstrucción por carbonilla?)",
    "P0402": "EGR - Flujo Excesivo Detectado (¿Válvula EGR quedó abierta?)",
    "P0403": "Circuito de Control de Válvula EGR - Falla Eléctrica",
    "P0404": "EGR - Rango / Rendimiento del Circuito de Control",
    "P0405": "Sensor de Posición de EGR 'A' - Señal Baja",
    "P0406": "Sensor de Posición de EGR 'A' - Señal Alta",
    "P2002": "Eficiencia de Filtro de Partículas Diésel (DPF) por debajo del umbral",
    "P2452": "Sensor de Presión Diferencial DPF - Falla de Circuito",
    "P2453": "Sensor de Presión Diferencial DPF - Rango / Rendimiento",
    "P2463": "Filtro de Partículas Diésel (DPF) - Restricción / Acumulación de Hollín",
    "P2263": "Sistema de Sobrealimentación de Turbo - Rendimiento",
    "P0087": "Presión en Riel de Combustible (Common Rail) Demasiado Baja",
    "P0088": "Presión en Riel de Combustible Demasiado Alta",
    "P0562": "Voltaje del Sistema Bajo",
    "P0563": "Voltaje del Sistema Alto",
    "U0100": "Pérdida de Comunicación con ECM/PCM",
}

def describe_dtc(code):
    if code in DTC_DESCRIPTIONS:
        return DTC_DESCRIPTIONS[code]
    prefix = code[0]
    if prefix == "P":
        return "Código de Tren Motriz (Powertrain) específico o estándar OBD-II"
    if prefix == "C":
        return "Código de Chasis (ABS / ESP / Tracción)"
    if prefix == "B":
        return "Código de Carrocería (BCM / SRS Airbag / Confort)"
    if prefix == "U":
        return "Código de Red / Comunicación CAN Bus"
    return "Código de falla OBD-II"


# Decodificadores individuales para cada PID
def dec_load(d): return round(u8(d[0]) * 100.0 / 255.0, 1)
def dec_temp_offset40(d): return u8(d[0]) - 40
def dec_u8(d): return u8(d[0])
def dec_rpm(d): return round(u16(d[0], d[1]) / 4.0)
def dec_maf(d): return round(u16(d[0], d[1]) / 100.0, 2)
def dec_throttle(d): return round(u8(d[0]) * 100.0 / 255.0, 1)
def dec_runtime(d): return u16(d[0], d[1])
def dec_dist(d): return u16(d[0], d[1])
def dec_rail_gauge(d): return round((u16(d[0], d[1]) * 10.0) / 100.0, 1)  # bar
def dec_rail_abs(d): return round((u16(d[0], d[1]) * 10.0) / 100.0, 1)  # bar
def dec_egr_error(d): return round((u8(d[0]) - 128) * 100.0 / 128.0, 1)
def dec_voltage(d): return round(u16(d[0], d[1]) / 1000.0, 2)
def dec_fuel_rate(d): return round(u16(d[0], d[1]) * 0.05, 2)
def dec_timing(d): return round(u8(d[0]) / 2.0 - 64.0, 1)
def dec_torque_pct(d): return u8(d[0]) - 125
def dec_ref_torque(d): return u16(d[0], d[1])
def dec_egt_16b(d): return round(u16(d[0], d[1]) * 0.1 - 40.0, 1)

def dec_boost_cmd(d):
    # PID 0170: Byte A = support bits, B..C = Cmd Boost A (* 0.03125 kPa)
    if len(d) >= 3:
        return round(u16(d[1], d[2]) * 0.03125, 1)
    return None

def dec_boost_act(d):
    # PID 0170: Byte A = support, B..C = Cmd, D..E = Act Boost A (* 0.03125 kPa)
    if len(d) >= 5:
        return round(u16(d[3], d[4]) * 0.03125, 1)
    return None

def dec_vgt_pos(d):
    # PID 0171: Byte A = support, B..C = Commanded VGT A
    if len(d) >= 3:
        # En algunos OEM viene escalado * 100 / 255 o / 327.68
        val = u16(d[1], d[2])
        if val <= 10000:
            return round(val * 0.01, 1)
        return round((u8(d[1]) * 100.0) / 255.0, 1)
    return None

def dec_dpf_deltap(d):
    # PID 017A: Byte A = support, B..C = Delta-P (* 0.03125 kPa -> mbar = kPa * 10)
    if len(d) >= 3:
        kpa = u16(d[1], d[2]) * 0.03125
        return round(kpa * 10.0, 1)  # mbar
    return None

def dec_dpf_temp_in(d):
    # PID 017C: Byte A = support, B..C = Temp In (* 0.1 - 40)
    if len(d) >= 3:
        return round(u16(d[1], d[2]) * 0.1 - 40.0, 1)
    return None

def dec_dpf_temp_out(d):
    # PID 017C: D..E = Temp Out (* 0.1 - 40)
    if len(d) >= 5:
        return round(u16(d[3], d[4]) * 0.1 - 40.0, 1)
    return None

def dec_dpf_soot(d):
    # PID 018C: bytes finales de masa de hollín / % carga
    if len(d) >= 11:
        val = u16(d[9], d[10])
        return round(val * 0.001, 1)  # % o g aproximado
    return None

def dec_coolant_67(d):
    # PID 0167: Byte A = support mask, Byte B = Temp 1 (offset 40)
    if len(d) >= 2:
        return u8(d[1]) - 40
    return None

def dec_iat_68(d):
    # PID 0168: Byte A = support mask, Byte B = Temp 1 (offset 40)
    if len(d) >= 2:
        return u8(d[1]) - 40
    return None

def dec_egr_temp_6b(d):
    # PID 016B: Byte A = support mask, Byte B..E = sensors (offset 40)
    if len(d) >= 2:
        # Buscar primer byte no-cero tras la máscara o usar B
        for b in d[1:5]:
            v = u8(b)
            if v != 0 and v != 255:
                return v - 40
        return u8(d[1]) - 40
    return None

def dec_cac_temp_77(d):
    # PID 0177: Charge Air Cooler Temp (Intercooler)
    if len(d) >= 2:
        for b in d[1:5]:
            v = u8(b)
            if v != 0 and v != 255:
                return v - 40
        return u8(d[1]) - 40
    return None

def dec_turbo_temp_75(d):
    # PID 0175: Turbocharger Temperature
    if len(d) >= 2:
        for b in d[1:5]:
            v = u8(b)
            if v != 0 and v != 255:
                return v - 40
        return u8(d[1]) - 40
    return None

def dec_egt_78(d):
    # PID 0178: EGT Bank 1 Sensor 1 (2 bytes * 0.1 - 40)
    if len(d) >= 3:
        return round(u16(d[1], d[2]) * 0.1 - 40.0, 1)
    return None


# Catálogo maestro de sensores disponibles
# Nota: varios sensores virtuales (como 0170_CMD y 0170_ACT) comparten el mismo PID físico OBD ("0170")
# para evitar enviar múltiples peticiones por red por un mismo frame.
SENSOR_CATALOG = [
    # --- CATEGORÍA: TEMPERATURAS Y REFRIGERANTE (CRÍTICO POST-ARMADO) ---
    {
        "id": "0105",
        "pid": "0105",
        "name": "Temp. Refrigerante (ECT)",
        "short": "Refrigerante",
        "unit": "°C",
        "category": "cooling",
        "min": -20,
        "max": 120,
        "warn_high": 96,
        "crit_high": 103,
        "description": "Temperatura principal del líquido refrigerante. Vital para verificar purgado sin burbujas y apertura de termostato (~82-88°C).",
        "decoder": dec_temp_offset40,
        "min_bytes": 1,
    },
    {
        "id": "0167",
        "pid": "0167",
        "name": "Temp. Refrigerante Sensor 2",
        "short": "ECT Auxiliar",
        "unit": "°C",
        "category": "cooling",
        "min": -20,
        "max": 120,
        "warn_high": 96,
        "crit_high": 103,
        "description": "Lectura de sensor de temperatura de refrigerante extendido (PID 67).",
        "decoder": dec_coolant_67,
        "min_bytes": 2,
    },
    {
        "id": "015C",
        "pid": "015C",
        "name": "Temp. Aceite Motor",
        "short": "Aceite",
        "unit": "°C",
        "category": "cooling",
        "min": -20,
        "max": 140,
        "warn_high": 115,
        "crit_high": 125,
        "description": "Temperatura del aceite del motor. Debe subir progresivamente detrás del refrigerante.",
        "decoder": dec_temp_offset40,
        "min_bytes": 1,
    },
    {
        "id": "016B",
        "pid": "016B",
        "name": "Temp. Gases EGR (Enfriador)",
        "short": "Temp EGR",
        "unit": "°C",
        "category": "cooling",
        "min": -20,
        "max": 450,
        "warn_high": 320,
        "crit_high": 400,
        "description": "Temperatura de recirculación EGR. Si el enfriador EGR tiene aire atrapado tras vaciar coolant, puede dispararse.",
        "decoder": dec_egr_temp_6b,
        "min_bytes": 2,
    },
    {
        "id": "010F",
        "pid": "010F",
        "name": "Temp. Aire Admisión (IAT)",
        "short": "Aire Admisión",
        "unit": "°C",
        "category": "cooling",
        "min": -20,
        "max": 100,
        "warn_high": 65,
        "crit_high": 80,
        "description": "Temperatura del aire entrando al motor. Confirma que el sensor IAT quedó conectado y leyendo coherente.",
        "decoder": dec_temp_offset40,
        "min_bytes": 1,
    },
    {
        "id": "0168",
        "pid": "0168",
        "name": "Temp. Aire Admisión Sensor 2",
        "short": "IAT Múltiple",
        "unit": "°C",
        "category": "cooling",
        "min": -20,
        "max": 100,
        "warn_high": 65,
        "crit_high": 80,
        "description": "Sensor secundario de temperatura de aire de admisión (PID 68).",
        "decoder": dec_iat_68,
        "min_bytes": 2,
    },
    {
        "id": "0177",
        "pid": "0177",
        "name": "Temp. Post-Intercooler (CAC)",
        "short": "Intercooler",
        "unit": "°C",
        "category": "cooling",
        "min": -20,
        "max": 120,
        "warn_high": 75,
        "crit_high": 90,
        "description": "Temperatura del aire a la salida del intercooler.",
        "decoder": dec_cac_temp_77,
        "min_bytes": 2,
    },
    {
        "id": "0175",
        "pid": "0175",
        "name": "Temp. Turbocompresor",
        "short": "Temp Turbo",
        "unit": "°C",
        "category": "cooling",
        "min": -20,
        "max": 900,
        "warn_high": 750,
        "crit_high": 850,
        "description": "Temperatura medida en carcasa o zona de turbo.",
        "decoder": dec_turbo_temp_75,
        "min_bytes": 2,
    },
    {
        "id": "0146",
        "pid": "0146",
        "name": "Temp. Aire Ambiente",
        "short": "Ambiente",
        "unit": "°C",
        "category": "cooling",
        "min": -30,
        "max": 60,
        "description": "Temperatura exterior medida por el vehículo (referencia base para motor frío).",
        "decoder": dec_temp_offset40,
        "min_bytes": 1,
    },

    # --- CATEGORÍA: ADMISIÓN, TURBO Y EGR (HERMETICIDAD POST-ARMADO) ---
    {
        "id": "010B",
        "pid": "010B",
        "name": "Presión Múltiple (MAP)",
        "short": "MAP Absoluta",
        "unit": "kPa",
        "category": "intake_boost",
        "min": 20,
        "max": 280,
        "warn_low": 80,
        "description": "Presión absoluta en la admisión. Con motor apagado debe igualar la barométrica (~100 kPa). Clave para detectar fugas o sensor tapado.",
        "decoder": dec_u8,
        "min_bytes": 1,
    },
    {
        "id": "0133",
        "pid": "0133",
        "name": "Presión Barométrica",
        "short": "Baro",
        "unit": "kPa",
        "category": "intake_boost",
        "min": 60,
        "max": 110,
        "description": "Presión atmosférica local de referencia.",
        "decoder": dec_u8,
        "min_bytes": 1,
    },
    {
        "id": "0170_CMD",
        "pid": "0170",
        "name": "Turbo Solicitado (Objetivo ECU)",
        "short": "Turbo Cmd",
        "unit": "kPa",
        "category": "intake_boost",
        "min": 80,
        "max": 280,
        "description": "Presión de sobrealimentación exigida por la computadora.",
        "decoder": dec_boost_cmd,
        "min_bytes": 3,
    },
    {
        "id": "0170_ACT",
        "pid": "0170",
        "name": "Turbo Real (Medido)",
        "short": "Turbo Act",
        "unit": "kPa",
        "category": "intake_boost",
        "min": 80,
        "max": 280,
        "description": "Presión real medida en el sistema de sobrealimentación. Si queda muy por debajo del objetivo, revisar abrazaderas de admisión o MAP.",
        "decoder": dec_boost_act,
        "min_bytes": 5,
    },
    {
        "id": "0171",
        "pid": "0171",
        "name": "Comando Geometría Turbo (VGT)",
        "short": "Actuador VGT",
        "unit": "%",
        "category": "intake_boost",
        "min": 0,
        "max": 100,
        "description": "Posición comandada al actuador electrónico de geometría variable.",
        "decoder": dec_vgt_pos,
        "min_bytes": 3,
    },
    {
        "id": "0110",
        "pid": "0110",
        "name": "Flujo Masa de Aire (MAF)",
        "short": "MAF",
        "unit": "g/s",
        "category": "intake_boost",
        "min": 0,
        "max": 250,
        "description": "Caudal de aire entrando por el filtro. En ralentí ~7-11 g/s. Valores muy bajos indican fuga de aire después del MAF o EGR abierta.",
        "decoder": dec_maf,
        "min_bytes": 2,
    },
    {
        "id": "012C",
        "pid": "012C",
        "name": "EGR Comandada",
        "short": "EGR Cmd",
        "unit": "%",
        "category": "intake_boost",
        "min": 0,
        "max": 100,
        "description": "Apertura ordenada a la válvula EGR tras armar la admisión.",
        "decoder": dec_throttle,
        "min_bytes": 1,
    },
    {
        "id": "012D",
        "pid": "012D",
        "name": "Error de Posición EGR",
        "short": "Error EGR",
        "unit": "%",
        "category": "intake_boost",
        "min": -100,
        "max": 100,
        "warn_high": 15,
        "warn_low": -15,
        "description": "Desvío entre apertura EGR ordenada y real. Valores cercanos a 0% confirman que la EGR quedó bien armada y sin atascos.",
        "decoder": dec_egr_error,
        "min_bytes": 1,
    },
    {
        "id": "0111",
        "pid": "0111",
        "name": "Posición Mariposa Admisión",
        "short": "Mariposa",
        "unit": "%",
        "category": "intake_boost",
        "min": 0,
        "max": 100,
        "description": "Apertura de la mariposa de admisión (anti-shudder / control EGR).",
        "decoder": dec_throttle,
        "min_bytes": 1,
    },
    {
        "id": "014C",
        "pid": "014C",
        "name": "Actuador Mariposa Comandado",
        "short": "Cmd Mariposa",
        "unit": "%",
        "category": "intake_boost",
        "min": 0,
        "max": 100,
        "description": "Orden enviada al cuerpo de mariposa en la admisión.",
        "decoder": dec_throttle,
        "min_bytes": 1,
    },

    # --- CATEGORÍA: NIVELES, ELÉCTRICO Y TIEMPOS ---
    {
        "id": "ATRV",
        "pid": "ATRV",
        "name": "Voltaje Batería (OBD Pin 16)",
        "short": "Batería OBD",
        "unit": "V",
        "category": "electrical_levels",
        "min": 10,
        "max": 16,
        "warn_low": 12.1,
        "crit_low": 11.6,
        "warn_high": 15.0,
        "description": "Voltaje directo en el puerto OBD2. Motor apagado ~12.4-12.7V; motor en marcha (alternador cargando) ~13.8-14.5V.",
        "decoder": None,
        "min_bytes": 0,
    },
    {
        "id": "0142",
        "pid": "0142",
        "name": "Voltaje Módulo Control (ECU)",
        "short": "Voltaje ECU",
        "unit": "V",
        "category": "electrical_levels",
        "min": 10,
        "max": 16,
        "warn_low": 12.0,
        "warn_high": 15.0,
        "description": "Voltaje interno medido por la computadora del motor.",
        "decoder": dec_voltage,
        "min_bytes": 2,
    },
    {
        "id": "012F",
        "pid": "012F",
        "name": "Nivel de Combustible",
        "short": "Combustible",
        "unit": "%",
        "category": "electrical_levels",
        "min": 0,
        "max": 100,
        "warn_low": 12,
        "description": "Nivel porcentual de combustible en el estanque reportado a la ECU.",
        "decoder": dec_throttle,
        "min_bytes": 1,
    },
    {
        "id": "011F",
        "pid": "011F",
        "name": "Tiempo Motor Encendido",
        "short": "Tiempo Marcha",
        "unit": "s",
        "category": "electrical_levels",
        "min": 0,
        "max": 65535,
        "description": "Segundos transcurridos desde el último arranque. Útil para controlar el tiempo de purgado térmico.",
        "decoder": dec_runtime,
        "min_bytes": 2,
    },
    {
        "id": "0121",
        "pid": "0121",
        "name": "Distancia con Check Engine (MIL)",
        "short": "Dist. MIL",
        "unit": "km",
        "category": "electrical_levels",
        "min": 0,
        "max": 65535,
        "description": "Kilómetros recorridos con la luz de falla encendida.",
        "decoder": dec_dist,
        "min_bytes": 2,
    },
    {
        "id": "0131",
        "pid": "0131",
        "name": "Distancia desde Borrado DTCs",
        "short": "Dist. Borrado",
        "unit": "km",
        "category": "electrical_levels",
        "min": 0,
        "max": 65535,
        "description": "Kilómetros recorridos desde el último reseteo de fallas.",
        "decoder": dec_dist,
        "min_bytes": 2,
    },

    # --- CATEGORÍA: MOTOR E INYECCIÓN ---
    {
        "id": "010C",
        "pid": "010C",
        "name": "Revoluciones del Motor",
        "short": "RPM",
        "unit": "RPM",
        "category": "fuel_engine",
        "min": 0,
        "max": 5000,
        "warn_high": 4200,
        "description": "Velocidad de giro del cigüeñal (ralentí normal ~750-950 RPM según temperatura).",
        "decoder": dec_rpm,
        "min_bytes": 2,
    },
    {
        "id": "010D",
        "pid": "010D",
        "name": "Velocidad del Vehículo",
        "short": "Velocidad",
        "unit": "km/h",
        "category": "fuel_engine",
        "min": 0,
        "max": 220,
        "description": "Velocidad de desplazamiento en ruta.",
        "decoder": dec_u8,
        "min_bytes": 1,
    },
    {
        "id": "0104",
        "pid": "0104",
        "name": "Carga Calculada del Motor",
        "short": "Carga Motor",
        "unit": "%",
        "category": "fuel_engine",
        "min": 0,
        "max": 100,
        "description": "Porcentaje de carga demandada al motor.",
        "decoder": dec_load,
        "min_bytes": 1,
    },
    {
        "id": "0149",
        "pid": "0149",
        "name": "Posición Pedal Acelerador (D)",
        "short": "Pedal",
        "unit": "%",
        "category": "fuel_engine",
        "min": 0,
        "max": 100,
        "description": "Posición de lectura del sensor de pedal.",
        "decoder": dec_throttle,
        "min_bytes": 1,
    },
    {
        "id": "0123",
        "pid": "0123",
        "name": "Presión Riel Combustible",
        "short": "Riel Diésel",
        "unit": "bar",
        "category": "fuel_engine",
        "min": 0,
        "max": 2200,
        "warn_low": 200,
        "description": "Presión de inyección Common Rail (~250-300 bar en ralentí, hasta 1800+ bar en carga).",
        "decoder": dec_rail_gauge,
        "min_bytes": 2,
    },
    {
        "id": "015E",
        "pid": "015E",
        "name": "Consumo Instantáneo Combustible",
        "short": "Caudal L/h",
        "unit": "L/h",
        "category": "fuel_engine",
        "min": 0,
        "max": 60,
        "description": "Tasa de consumo de combustible por hora.",
        "decoder": dec_fuel_rate,
        "min_bytes": 2,
    },
    {
        "id": "0162",
        "pid": "0162",
        "name": "Torque Actual Motor",
        "short": "Torque %",
        "unit": "%",
        "category": "fuel_engine",
        "min": -50,
        "max": 120,
        "description": "Porcentaje de torque actual respecto al torque de referencia.",
        "decoder": dec_torque_pct,
        "min_bytes": 1,
    },
    {
        "id": "0163",
        "pid": "0163",
        "name": "Torque de Referencia Motor",
        "short": "Torque Ref",
        "unit": "Nm",
        "category": "fuel_engine",
        "min": 0,
        "max": 800,
        "description": "Torque nominal máximo del motor configurado en ECU.",
        "decoder": dec_ref_torque,
        "min_bytes": 2,
    },

    # --- CATEGORÍA: DPF Y ESCAPE ---
    {
        "id": "017A",
        "pid": "017A",
        "name": "Presión Diferencial DPF",
        "short": "DPF Delta-P",
        "unit": "mbar",
        "category": "dpf_exhaust",
        "min": 0,
        "max": 400,
        "warn_high": 40,
        "crit_high": 80,
        "description": "Contrapresión diferencial a través del DPF. Ralentí sano < 15 mbar.",
        "decoder": dec_dpf_deltap,
        "min_bytes": 3,
    },
    {
        "id": "017C_IN",
        "pid": "017C",
        "name": "Temp. Entrada DPF (EGT)",
        "short": "EGT Entrada",
        "unit": "°C",
        "category": "dpf_exhaust",
        "min": 0,
        "max": 800,
        "warn_high": 680,
        "description": "Temperatura de gases antes de entrar al filtro de partículas.",
        "decoder": dec_dpf_temp_in,
        "min_bytes": 3,
    },
    {
        "id": "017C_OUT",
        "pid": "017C",
        "name": "Temp. Salida DPF (EGT)",
        "short": "EGT Salida",
        "unit": "°C",
        "category": "dpf_exhaust",
        "min": 0,
        "max": 800,
        "warn_high": 680,
        "description": "Temperatura de gases al salir del DPF.",
        "decoder": dec_dpf_temp_out,
        "min_bytes": 5,
    },
    {
        "id": "018C",
        "pid": "018C",
        "name": "Saturación de Hollín DPF",
        "short": "Hollín DPF",
        "unit": "%",
        "category": "dpf_exhaust",
        "min": 0,
        "max": 120,
        "warn_high": 85,
        "crit_high": 100,
        "description": "Porcentaje estimado de carga de hollín acumulado en el DPF.",
        "decoder": dec_dpf_soot,
        "min_bytes": 11,
    },
    {
        "id": "0178",
        "pid": "0178",
        "name": "Temp. Gases Escape Banco 1",
        "short": "EGT B1S1",
        "unit": "°C",
        "category": "dpf_exhaust",
        "min": 0,
        "max": 900,
        "warn_high": 750,
        "description": "Sensor de temperatura de gases de escape primario.",
        "decoder": dec_egt_78,
        "min_bytes": 3,
    },
]

CATALOG_BY_ID = {item["id"]: item for item in SENSOR_CATALOG}

CATEGORIES = [
    {"id": "cooling", "name": "Refrigerante y Temperaturas", "icon": "🌡️"},
    {"id": "intake_boost", "name": "Admisión, Turbo y EGR", "icon": "🌀"},
    {"id": "electrical_levels", "name": "Niveles, Voltaje y Tiempos", "icon": "🔋"},
    {"id": "fuel_engine", "name": "Motor e Inyección", "icon": "⚙️"},
    {"id": "dpf_exhaust", "name": "DPF y Escape", "icon": "🛡️"},
]

# PIDs por defecto confirmados en la SsangYong Musso 2022 para modo exploración offline/demo
MUSSO_DEFAULT_SUPPORTED = [s["id"] for s in SENSOR_CATALOG]

def extract_data_bytes(raw_str, expected_mode, expected_pid_hex):
    """
    Limpia respuestas ELM327 de una o múltiples líneas ISO-TP (ej. '00C 0: 41 70 07 ... 1: 7C ...')
    y devuelve la lista de bytes útiles inmediatamente después de [mode, pid].
    """
    if not raw_str or "NO DATA" in raw_str or "ERROR" in raw_str or "UNABLE" in raw_str or "STOPPED" in raw_str:
        return []
    cleaned = raw_str.replace("\r", " ").replace("\n", " ").replace(":", " ")
    tokens = cleaned.split()
    # Filtrar tokens hex de 2 caracteres (descartando índices de frame como '0', '1', '00C' etc.)
    hex_bytes = []
    for t in tokens:
        if len(t) == 2:
            try:
                int(t, 16)
                hex_bytes.append(t.upper())
            except ValueError:
                pass
    # Buscar secuencia expected_mode + expected_pid_hex
    m = expected_mode.upper()
    p = expected_pid_hex.upper()
    for i in range(len(hex_bytes) - 1):
        if hex_bytes[i] == m and hex_bytes[i + 1] == p:
            return hex_bytes[i + 2:]
    return []
