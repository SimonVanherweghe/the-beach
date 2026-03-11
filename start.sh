#!/usr/bin/env bash
set -e

cd "$(dirname "$0")"

# --- Python virtualenv + dependencies ---
if [ ! -d ".venv" ]; then
  echo "🐍 Creating Python virtual environment..."
  python3 -m venv .venv
fi

echo "🐍 Installing Python dependencies..."
.venv/bin/pip install -q -r requirements.txt

# --- Node dependencies ---
echo "📦 Installing Node dependencies..."
npm install --silent

echo "📦 Building project..."
npm run build

echo "☕ Starting server with caffeinate (sleep prevention)..."
caffeinate -dims node index.mjs "$@"

open "http://localhost:3005"