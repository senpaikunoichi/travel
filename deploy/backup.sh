#!/usr/bin/env bash
set -euo pipefail

BACKUP_ROOT=/var/backups/mantenimiento
UPLOADS=/var/www/mantenimiento/backend/uploads
MYSQL_CNF=/etc/mantenimiento/mysql-backup.cnf
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
DEST="$BACKUP_ROOT/$STAMP"

if [[ $EUID -ne 0 ]]; then
  echo "Ejecuta este script con sudo." >&2
  exit 1
fi
if [[ ! -f "$MYSQL_CNF" || ! -d "$UPLOADS" ]]; then
  echo "Faltan $MYSQL_CNF o $UPLOADS." >&2
  exit 1
fi

install -d -m 0700 "$DEST"
mysqldump --defaults-extra-file="$MYSQL_CNF" --single-transaction --no-tablespaces --routines --triggers --events --databases mantenimiento | gzip > "$DEST/database.sql.gz"
tar -czf "$DEST/uploads.tar.gz" -C "$(dirname "$UPLOADS")" "$(basename "$UPLOADS")"
sha256sum "$DEST/database.sql.gz" "$DEST/uploads.tar.gz" > "$DEST/SHA256SUMS"
chmod -R go-rwx "$DEST"
echo "Respaldo creado en $DEST. Copialo ahora a un almacenamiento externo."
