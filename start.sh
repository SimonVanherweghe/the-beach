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
# Recreate venv if it was built with a different Python version
VENV_PYTHON=".venv/bin/python"
if [ -d ".venv" ] && [ -x "$VENV_PYTHON" ]; then
  VENV_VER=$("$VENV_PYTHON" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
  WANT_VER=$("$PYTHON" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
  if [ "$VENV_VER" != "$WANT_VER" ]; then
    echo "🐍 Venv uses Python $VENV_VER but we need $WANT_VER — recreating..."
    rm -rf .venv
  fi
fi
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