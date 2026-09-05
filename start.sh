#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "======================================================"
echo " 🚀 WhatsApp Monthly Sender - WSL Quickstart"
echo "======================================================"

# 1. Check Node.js
if ! command -v node >/dev/null 2>&1; then
  echo "❌ Node.js is not installed. Please install Node.js 20 or higher:"
  echo "   curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -"
  echo "   sudo apt-get install -y nodejs"
  exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
  echo "⚠️  Warning: Node.js 20+ is required (found $(node -v))."
fi

# 2. Check .env
if [ ! -f ".env" ]; then
  echo "📄 Creating .env from .env.example..."
  cp .env.example .env
fi

# 3. Check dependencies
if [ ! -d "node_modules" ]; then
  echo "📦 Installing npm dependencies..."
  npm install
fi

# 4. Check build
if [ ! -f "dist/index.js" ] || [ "src/api/dashboard.html" -nt "dist/api/dashboard.html" ]; then
  echo "🔨 Building TypeScript project..."
  npm run build
fi

echo "------------------------------------------------------"
echo "✅ Everything is ready!"
echo "📱 Open Dashboard: http://localhost:3000"
echo "🔐 Set up your admin password on first visit."
echo "📲 Connect WhatsApp via QR code or Pairing Code (no camera)."
echo "------------------------------------------------------"
echo "Starting server in production mode..."
echo ""

exec node dist/index.js
