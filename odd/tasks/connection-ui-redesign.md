# Feature: Connection Interface Modernization (Mobile & Desktop)

## Objective
Redesign the OBD-II connection interface from a cluttered, cramped header drawer with uncoordinated colors into an intuitive, accessible, and responsive Connection Hub / Modal optimized for both mobile touch and desktop environments.

## Problem Statement
The current connection UI suffers from:
1. **Cognitive overload & poor visual hierarchy**: 10 buttons of disparate colors (sky, indigo, emerald, amber, red) are crammed into a single wrapping row.
2. **Ergonomic issues (Mobile & Web)**: Form fields (`inpBaud`, `inpIp`, `inpPort`) are tiny (`text-[11px]`, `py-1`, `w-16`, `w-24`), well below standard 44-48px touch targets.
3. **Muddled domain boundaries**: Connection controls (BLE, Serial, Wi-Fi, Demo) are interleaved with session actions (sound alert, CSV logging, report export).
4. **Obscured state**: Wi-Fi bridge instructions and Vehicle ID (VIN/ECU/Calibration) are hidden inside the collapsible drawer.

## Scope & Constraints
- **Scope**:
  - Transform connection interface into a responsive Connection Modal / Bottom-Sheet (`#connectionModal`).
  - Provide a clean 4-tab selector: Bluetooth (BLE), USB/Serial, Wi-Fi Bridge, Demo Mode.
  - Generous touch targets (min 44-48px) and readable inputs (14-16px font size to avoid mobile browser auto-zoom).
  - Clear compatibility indicators (Web Bluetooth, Web Serial) and real-time local bridge status.
  - Dedicated utility bar / quick actions in header for Audio Alerts, CSV Logging, and HTML Report.
  - Prominent vehicle status ribbon (VIN, ECU, Calibration ID) visible when connected.
  - Consistent design system using Tailwind slate palette with subtle accents, eliminating the rainbow collage.
- **Constraints**:
  - Keep all existing IDs and transport bindings backward-compatible (`btnConnBle`, `btnConnSerial`, `inpBaud`, `inpIp`, `inpPort`, `inpBridgeUrl`, etc.).
  - Pure client-side JS + HTML + Tailwind CSS.
  - Retain all connection error handling and transport events.

## Actionable Checklist
- [x] TASK-1: Create `odd/tasks/connection-ui-redesign.md` and sync recovery state to Engram.
- [x] TASK-2: Redesign connection modal and header structure in `docs/index.html`.
- [x] TASK-3: Update connection modal logic, tab switching, and capability detection in `docs/js/app.js`.
- [x] TASK-4: Test mobile and desktop responsive layout and verify in browser.
- [x] TASK-5: Run lint/validation and verify clean state.

## Verification Evidence
- JavaScript syntax check: `node -c docs/js/app.js` passed with zero errors.
- HTTP server verification: `http://127.0.0.1:8080` successfully serving `connectionModal` and updated header structure.
- Backward compatibility: preserved all transport IDs (`btnConnBle`, `btnConnSerial`, `inpBaud`, `btnConnWifi`, `btnDemo`, `inpIp`, `inpPort`, `inpBridgeUrl`, etc.).
- Responsive layout: mobile renders touch-friendly bottom sheet (min 44-48px touch targets), desktop renders centered floating modal.
- Aesthetics: replaced chaotic multi-color button row with sleek Slate-900 / Slate-950 design system and focused accents.
