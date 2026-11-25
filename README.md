# OBD2 Studio

A lightweight, dependency-free Python web application and real-time diagnostic dashboard for **ELM327 Wi-Fi** OBD-II adapters (tested with Vgate iCar 2 on a SsangYong Musso 2.2 e-XDi D22DTR).

## Features

- **Zero External Dependencies**: Built purely on the Python 3 standard library (`ThreadingHTTPServer`, `socket`, `threading`, `csv`, `json`).
- **Direct TCP Socket Bridge**: Connects straight to `192.168.0.10:35000` without virtual COM port drivers, plus a one-click Windows `V-LINK` Wi-Fi helper and an offline **Demo Simulator** mode.
- **Automatic PID Discovery**: Queries `0100`, `0120`, `0140`, `0160`, and `0180` bitmasks to discover supported sensors on the ECU.
- **Post-Reassembly & Coolant Bleed Monitor**:
  - Dedicated DTC inspector (Modes `0101` MIL & readiness monitors, `03` Confirmed, `07` Pending, `0A` Permanent, `02` Freeze Frame) with a KOEO (`RPM == 0`) safety guard before clearing codes (`04`).
  - Real-time thermal monitor for Coolant (`0105` / `0167`), EGR Gas Temp (`016B`), Oil Temp (`015C`), IAT (`010F`), and Charge Air Cooler (`0177`) with threshold alerts.
  - Intake/boost leak & level checks: MAP (`010B`) vs Baro (`0133`), Turbo Commanded vs Actual (`0170`), VGT Actuator (`0171`), MAF (`0110`), EGR Commanded & Error (`012C` / `012D`), Common Rail Pressure (`0123`), Fuel Level (`012F`), Battery Voltage (`ATRV` / `0142`), and DPF Delta-P (`017A`).
- **Full Sensor Explorer & CSV Logger**: Sweep all supported PIDs on demand and log live telemetry to `logs/`.
- **Custom Dashboard Builder**: Create, edit, and save custom viewers combining numerical cards, threshold gauges, and live HTML5 Canvas charts.

## Quick Start

```bash
python server.py
```

Then open [http://127.0.0.1:8080](http://127.0.0.1:8080) in your browser.

To run on a different port:

```bash
OBD_WEB_PORT=8090 python server.py
```
