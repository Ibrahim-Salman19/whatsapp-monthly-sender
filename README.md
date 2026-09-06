# WhatsApp Monthly Sender

A production-grade, self-hosted automation platform for scheduled and on-demand WhatsApp message distribution with human-paced anti-ban protection, multi-channel linking (QR & pairing code), real-time progress streaming, contact group segmentation, and persistent diagnostics.

---

## Key Features

- **Comprehensive Anti-Ban Architecture**:
  - **Spintax Syntax Engine**: Nested syntax `{Hi|Hello|{Assalam-o-Alaikum|Salam}}` produces unique text for every single recipient, completely defeating Meta's cryptographic spam hash detectors.
  - **Smart Batching & Cooldowns**: Pauses for a human-like break (e.g. 120 seconds every 15 messages) with live countdown timers.
  - **Quiet Hours Protection**: Automatically pauses dispatch between late night hours (e.g. 22:00–08:00) to keep recipient interactions respectful and safe.
  - **Dynamic Simulated Typing**: Calculates simulated `composing` duration proportional to message length.
  - **Baileys v7 Retry Protocol**: Built-in `getMessage` callback and 500-message FIFO cache to satisfy WhatsApp server re-encryption retries without dropping messages; instant recovery on code 515 (`restartRequired`).
  - **Direct SQLite Quota Meter**: Real-time 24-hour rate-limiting enforced directly at the database layer.

- **Extreme Reliability & WSL 24/7 Autostart**:
  - **Windows 1-Click Background Autostart**: Zero-window silent background VBScript launcher and 1-click startup installer (`deploy/windows/install-startup.bat`).
  - **Auto-Reconnection**: Resilient socket lifecycle with exponential backoff; automatically recovers from network drops mid-send.
  - **Socket Drop Immunity**: Dynamically resolves active sockets and pauses up to 45 seconds during network blips instead of aborting the batch.
  - **Phone Normalization**: Accepts Pakistani (`03001234567`) and international formats; normalizes and validates automatically (10–15 digits).
  - **WhatsApp Existence Check**: Pre-verifies numbers via `sock.onWhatsApp()` before sending to avoid useless retries on unregistered numbers.
  - **Catch-Up Engine**: Accurate timezone calculations via Croner to execute missed sends when the host machine was offline.
  - **Embedded Migrations**: Idempotent SQLite migrations embedded in TypeScript; works identically in `tsx` dev and compiled `dist/` production.
  - **Crash Resilience**: Global unhandled exception traps, SQLite WAL checkpoints, and rotating event logs (`data/logs/events.log`).

- **User-Friendly Dashboard**:
  - **In-Browser Pairing**: Displays real-time QR code data URLs and on-demand 8-character Pairing Codes (`ABCD-1234`) directly on the web UI.
  - **Live Dispatch Streaming**: Server-Sent Events (SSE) with real-time percentage progress bar, batch cooldown countdown, activity log, and 1-click abort.
  - **Live Spintax Preview**: Test template variations with 3 random generated outputs in WhatsApp chat bubble mockups.
  - **Quick Test Modal**: Send instant test messages to any phone number or saved contact without recording to monthly history.
  - **Contact Management & CSV Export**: Real-time search, group badge pills, active/inactive/opt-out filters, and 1-click CSV export/import with file upload.
  - **Send History Audit & Export**: Monthly delivery records, retry failed contacts with 1-click, and CSV export.
  - **System Diagnostics**: Live event logs feed with level filters (`ALL`, `INFO`, `WARN`, `ERROR`) and auto-refresh.
  - **Backup & Restore**: Download SQLite backups or restore from an existing backup directly from the Settings page.

---

## Quick Start

### Prerequisites
- Node.js 20+ (Node 22 recommended)
- npm

### ⚡ 1-Command WSL Launch (Recommended)

Just clone and run:
```bash
./start.sh
```
`start.sh` automatically checks Node.js, provisions `.env`, installs dependencies, builds TypeScript, and launches the production server at **http://localhost:3000**!

### Manual Installation & Run

```bash
git clone https://github.com/Ibrahim-Salman19/whatsapp-monthly-sender.git
cd whatsapp-monthly-sender
npm install
cp .env.example .env

# Run test suite
npm test

# Build & start production server
npm run build
npm start

# Or start development server with hot-reloading
npm run dev
```

Open **http://localhost:3000** in your browser. On first boot, you will be prompted to create your admin password.

> **💡 Zero-Cost Remote Access**: To access your dashboard from your smartphone while outside your home network for $0 without port forwarding, see the [Cloudflare Tunnel Guide](deploy/cloudflare-tunnel.md).

---

## WhatsApp Linking Options

1. **QR Code Scanning**:
   - Open the web dashboard. If not connected, a fresh QR code appears.
   - On your phone: WhatsApp → **Settings** (or 3 dots) → **Linked Devices** → **Link a Device** and point your camera.
2. **Pairing Code (No Camera Needed)**:
   - On the dashboard Status page, enter your phone number under **Link with phone number instead**.
   - Click **Get Pairing Code** to receive an 8-digit code (e.g. `ABCD-1234`).
   - In WhatsApp: **Linked Devices** → **Link with phone number instead** and enter the code.

---

## Template Variables

Personalize your templates with the following variables:

| Variable | Description | Example Output |
|----------|-------------|----------------|
| `{{name}}` | Full name of contact | `Ahmed Khan` |
| `{{firstName}}` | First name only | `Ahmed` |
| `{{month}}` | Current month name | `September` / `ستمبر` |
| `{{year}}` | Current year | `2026` |
| `{{phone}}` | Formatted phone number | `+92 300 1234567` |
| `{{notes}}` | Contact's saved notes | `VIP Supporter` |
| `{{date}}` | Formatted date | `6 September 2026` |

---

## CLI Reference

```bash
npm run status              # Check current schedule and month statistics
npm run run-now             # Manually trigger the monthly batch send
npm run send                # Send test message to OWNER_PHONE
npx tsx src/index.ts --send-now 923001234567  # Send test to specific recipient
```

---

## Deployment & 24/7 Autostart Options

### 1. Windows 1-Click Background Autostart (Easiest for WSL)
If you are on Windows using WSL:
1. Double-click `deploy\windows\install-startup.bat` from Windows Explorer.
2. That's it! It automatically registers `start-background.vbs` in your Windows Startup directory.
3. Every time Windows turns on or boots up, the WhatsApp sender runs silently in the background on WSL.
4. To open the dashboard at any time, double-click `deploy\windows\open-dashboard.bat` (or open `http://localhost:3000`).
5. For in-depth WSL sleep prevention, `.wslconfig` mirrored networking, and 24/7 reliability, read the [WSL Master Guide](deploy/wsl-master-guide.md).

### 2. Systemd Service (Ubuntu / Debian / WSL2)
```bash
sudo ./deploy/setup-service.sh
```
This automatically compiles the project, resolves the active node path, configures `/etc/systemd/system/wa-sender.service`, and starts the service.

Manage the service:
```bash
sudo systemctl status wa-sender
sudo systemctl restart wa-sender
sudo journalctl -u wa-sender -f
```

### 3. Docker & Docker Compose
```bash
docker compose up -d --build
docker compose logs -f
```
The container runs on Node 22 slim with built-in native health checks (`/health`) and persistent SQLite storage mounted to `./data`.

---

## Anti-Ban & Compliance Safety Architecture

| Layer | Implementation | Default Value | Purpose |
| :--- | :--- | :--- | :--- |
| **Spintax Syntax** | Recursive regex engine `{A\|B\|{C\|D}}` | Enabled | Generates non-identical cryptographic message text per recipient |
| **Random Jitter** | Configurable sleep interval | 10s – 35s | Eliminates robotic interval patterns |
| **Smart Batching** | Batch limit before cooldown | 15 messages | Mimics natural human message batches |
| **Batch Cooldown** | Sleep duration between batches | 120 seconds | Allows recipient delivery reports to settle |
| **Quiet Hours** | Timezone-aware safe delivery window | 22:00 – 08:00 | Halts broadcasts during sleeping hours |
| **Simulated Typing** | `composing` presence proportional to text length | Scaled | Emulates genuine keyboard keystrokes |
| **STOP Compliance** | Auto opt-out on Urdu & English triggers | Immediate | Protects sender reputation against spam reports |
| **Daily Quota Cap** | SQLite transaction-level gatekeeper | 100 messages | Prevents accidental high-volume spikes |
| **Baileys v7 Retry Cache** | FIFO message cache + `getMessage` | 500 messages | Fixes "waiting for message" decrypt stalls on WhatsApp Web |
