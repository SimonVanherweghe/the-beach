#!/usr/bin/env bash
set -e

cd "$(dirname "$0")"

# --- Find Python 3.11+ (required by vpype 1.15+) ---
PYTHON=""
for candidate in python3.13 python3.12 python3.11; do
  if command -v "$candidate" &>/dev/null; then
    PYTHON="$candidate"
    break
  fi
done
if [ -z "$PYTHON" ]; then
  echo "❌ Python 3.11 or newer is required but not found."
  echo "   Install it from https://www.python.org/downloads/ and try again."
  exit 1
fi
echo "🐍 Using $($PYTHON --version)"

# --- Python virtualenv + dependencies ---
if [ ! -d ".venv" ]; then
  echo "🐍 Creating Python virtual environment..."
  "$PYTHON" -m venv .venv
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