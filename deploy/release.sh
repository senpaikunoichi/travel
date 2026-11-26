#!/usr/bin/env bash
set -euo pipefail

APP_ROOT=/var/www/mantenimiento
APP_USER=mantenimiento

if [[ $EUID -ne 0 ]]; then
  echo "Ejecuta este script con sudo." >&2
  exit 1
fi
if [[ ! -f "$APP_ROOT/backend/.env" || ! -f "$APP_ROOT/backend/package-lock.json" ]]; then
  echo "Faltan backend/.env o package-lock.json en $APP_ROOT." >&2
  exit 1
fi

install -d -o "$APP_USER" -g "$APP_USER" -m 0750 "$APP_ROOT/backend/uploads"

runuser -u "$APP_USER" -- bash -lc "cd '$APP_ROOT/backend' && npm ci && npm run check && npm test && npm run migrate"
runuser -u "$APP_USER" -- bash -lc "cd '$APP_ROOT/frontend' && npm ci && npm run lint && npm run build"

systemctl restart mantenimiento
nginx -t
systemctl reload nginx

curl --fail --silent --show-error http://127.0.0.1:5000/api/health >/dev/null
echo "Release instalada y health check correcto."
