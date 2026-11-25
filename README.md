# OBD2 Studio

A universal, installable **PWA (Progressive Web App)** and cross-platform Python Wi-Fi bridge for **OBD-II vehicle diagnostics**, real-time sensor monitoring, DTC inspection, and custom dashboard creation.

- **Live Static App (GitHub Pages):** [https://pgtoopx.github.io/obd2-studio/](https://pgtoopx.github.io/obd2-studio/)

## Transport Compatibility Matrix

| Adapter Type | Works Directly in Browser (GitHub Pages)? | Supported Platforms | Notes |
| :--- | :---: | :--- | :--- |
| **Bluetooth BLE (4.0/5.0)** | **Yes** (Web Bluetooth) | Android, Windows, Linux, macOS (Chrome / Edge) | Zero installation. Ideal for Vgate iCar Pro BLE, Veepeak BLE+, OBDLink CX. |
| **USB / Serial / BT Classic COM** | **Yes** (Web Serial) | Windows, Linux, macOS (Chrome / Edge Desktop) | Works like ESP32 web flashers (`/dev/ttyUSB0`, `/dev/rfcomm0`, `COMx`). |
| **Wi-Fi ELM327 (`192.168.0.10:35000`)** | Via **Local Bridge** | Windows & Linux (`start_windows.bat` / `start_linux.sh`) | Browsers cannot open raw TCP sockets; the zero-dependency Python bridge relays TCP to HTTP. |
| **Demo Simulator** | **Yes** (Client-Side JS) | All modern browsers | Simulates a SsangYong Musso 2.2 warming up after intake reassembly & coolant refill. |

## Quick Start

### Option 1: Browser-Only (Zero Install)
Open **[https://pgtoopx.github.io/obd2-studio/](https://pgtoopx.github.io/obd2-studio/)** in Chrome or Edge, click **Install App** (optional for offline use), and connect directly via **Bluetooth BLE** or **USB / Serial**.

### Option 2: Windows (with Wi-Fi Bridge support)
Double-click `start_windows.bat` or run:
```powershell
python server.py
```
Then open `http://127.0.0.1:8080` (or keep using the GitHub Pages PWA — it will automatically connect to the local bridge at `127.0.0.1:8080`).

### Option 3: Linux (with Wi-Fi Bridge support)
```bash
chmod +x start_linux.sh
./start_linux.sh
```
For USB/Serial adapters on Linux, make sure your user is in the `dialout` group (`sudo usermod -aG dialout $USER`).

## Key Capabilities

- **Post-Reassembly & Coolant Bleed Monitor**:
  - DTC Scanner (Modes `0101`, `03`, `07`, `0A`, `02` Freeze Frame) with KOEO (`RPM == 0`) guard before clearing codes (`04`).
  - Coolant thermal gauge & live chart (`0105`, `0167`), EGR Gas Temp (`016B`), Oil Temp (`015C`), IAT (`010F`), and Charge Air Cooler (`0177`) with threshold alerts.
  - Intake/boost leak checks: MAP (`010B`) vs Baro (`0133`), Turbo Commanded vs Actual (`0170`), VGT Actuator (`0171`), MAF (`0110`), EGR Commanded & Error (`012C` / `012D`), Common Rail (`0123`), Fuel Level (`012F`), Battery Voltage (`ATRV` / `0142`), and DPF Delta-P (`017A`).
- **Full Sensor Explorer**: Auto-discovers supported PIDs (`0100`–`0180`), sweeps all sensors on demand, and logs telemetry to downloadable CSV.
- **Custom View Builder**: Build and persist custom dashboards with gauges, cards, and real-time Canvas charts.
- **Offline PWA**: Service Worker caches assets so the app works without internet when connected to an OBD-II Wi-Fi hotspot (`V-LINK`) or out on the road.
