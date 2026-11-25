#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

PORT="${OBD_WEB_PORT:-8080}"
URL="http://127.0.0.1:${PORT}"

echo "Starting OBD2 Studio on ${URL} ..."
if command -v xdg-open >/dev/null 2>&1; then
  (sleep 1 && xdg-open "${URL}" >/dev/null 2>&1 || true) &
fi

exec python3 server.py
