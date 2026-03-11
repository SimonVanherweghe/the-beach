#!/usr/bin/env bash
set -e

cd "$(dirname "$0")"

echo "📦 Building project..."
npm run build

echo "☕ Starting server with caffeinate (sleep prevention)..."
caffeinate -dims node index.mjs "$@"
