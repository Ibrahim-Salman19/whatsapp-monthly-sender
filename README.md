# WhatsApp Monthly Sender

A production-grade, self-hosted automation platform for scheduled and on-demand WhatsApp message distribution with human-paced anti-ban protection, multi-channel linking (QR & pairing code), real-time progress streaming, contact group segmentation, and persistent diagnostics.

---

## Key Features

- **Extreme Reliability**:
  - **Auto-Reconnection**: Resilient socket lifecycle with exponential backoff; automatically recovers from network drops mid-send.
  - **Socket Drop Immunity**: Dynamically resolves active sockets and pauses up to 45 seconds during network blips instead of aborting the batch.
  - **Phone Normalization**: Accepts Pakistani (`03001234567`) and international formats; normalizes and validates automatically (10–15 digits).
  - **WhatsApp Existence Check**: Pre-verifies numbers via `sock.onWhatsApp()` before sending to avoid useless retries on unregistered numbers.
  - **Catch-Up Engine**: Accurate timezone calculations via Croner to execute missed sends when the host machine was offline.
  - **Embedded Migrations**: Idempotent SQLite migrations embedded in TypeScript; works identically in `tsx` dev and compiled `dist/` production.
  - **Crash Resilience**: Global unhandled exception traps, SQLite WAL checkpoints, and rotating event logs (`data/logs/events.log`).

- **User-Friendly Dashboard**:
  - **In-Browser Pairing**: Displays real-time QR code data URLs and on-demand 8-character Pairing Codes (`ABCD-1234`) directly on the web UI.
  - **Live Dispatch Streaming**: Server-Sent Events (SSE) with real-time percentage progress bar, activity log, and 1-click abort.
  - **Quick Test Modal**: Send instant test messages to any phone number or saved contact without recording to monthly history.
  - **Contact Management**: Real-time search, group badge pills, active/inactive/opt-out filters, and 1-click CSV export.
  - **Bulk Import Preview**: Pre-validation table for batch imports (`Name, Phone` or `Name, Phone, Notes`) with duplicate resolution options.
  - **Interactive Template Mockup**: Chat bubble preview with bold (`*`), italic (`_`), strikethrough (`~`), and dynamic variables (`{{name}}`, `{{firstName}}`, `{{month}}`, `{{year}}`, `{{phone}}`, `{{notes}}`, `{{date}}`).
  - **Exclusions Manager**: Dedicated table of per-month exclusions with 1-click removal.
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

## Deployment

### 1. Systemd Service (Ubuntu / Debian / WSL2)

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

### 2. Docker & Docker Compose

```bash
docker compose up -d --build
docker compose logs -f
```

The container runs on Node 22 slim with built-in native health checks (`/health`) and persistent SQLite storage mounted to `./data`.

---

## Anti-Ban & Compliance Safety

- **Randomized Jitter Delays**: Configurable random delay (default 4–10 seconds) between messages.
- **Typing Simulation**: Simulates WhatsApp `composing` presence before dispatching messages.
- **STOP Opt-Out Compliance**: Automatically handles incoming messages containing "STOP", "UNSUBSCRIBE", or Urdu variants ("ناٹ سبسکرائب"), marking contacts opted out immediately and silencing future broadcasts until explicitly re-enabled.
- **Daily Send Limit**: Automatically skips remaining recipients once the daily threshold is reached to protect sender reputation.
