#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
echo "Configuring WhatsApp Monthly Sender service for $DIR..."

# Build application
cd "$DIR"
npm run build

# Find node binary
NODE_BIN="$(which node || echo "/usr/bin/node")"
echo "Using Node binary: $NODE_BIN"

# Generate systemd unit file with exact paths
SERVICE_FILE="/etc/systemd/system/wa-sender.service"
cat << SERVICE_EOF > wa-sender.service.tmp
[Unit]
Description=WhatsApp Monthly Sender
After=network.target

[Service]
Type=simple
WorkingDirectory=$DIR
ExecStart=$NODE_BIN dist/index.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production
EnvironmentFile=-$DIR/.env

[Install]
WantedBy=multi-user.target
SERVICE_EOF

if command -v systemctl >/dev/null 2>&1 && [ "$EUID" -eq 0 ]; then
  mv wa-sender.service.tmp "$SERVICE_FILE"
  systemctl daemon-reload
  systemctl enable wa-sender
  systemctl restart wa-sender
  echo "Service installed and started: systemctl status wa-sender"
else
  mv wa-sender.service.tmp deploy/wa-sender.service
  echo "Generated deploy/wa-sender.service. Run with sudo to install into /etc/systemd/system/:"
  echo "  sudo cp deploy/wa-sender.service /etc/systemd/system/"
  echo "  sudo systemctl daemon-reload && sudo systemctl enable --now wa-sender"
fi
