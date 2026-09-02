#!/bin/bash
set -euo pipefail

# Backup diario de la base de datos PostgreSQL de 3Cars.
# Lee DATABASE_URL desde el .env del backend.
#
# Uso manual:
#   ./scripts/backup-db.sh
#
# Uso con cron (automático):
#   0 3 * * * cd /opt/3cars-backend && ./scripts/backup-db.sh >> /var/log/3cars-backup.log 2>&1

ENV_FILE="${ENV_FILE:-/opt/3cars-backend/.env}"
BACKUP_DIR="${BACKUP_DIR:-/opt/backups/3cars}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck source=/dev/null
  . "$ENV_FILE"
  set +a
else
  echo "[ERROR] No se encontró el .env: $ENV_FILE" >&2
  exit 1
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "[ERROR] DATABASE_URL no está definido en $ENV_FILE" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

DATE=$(date +%Y%m%d_%H%M%S)
FILE="$BACKUP_DIR/3cars_backup_${DATE}.sql.gz"

echo "[$(date -Iseconds)] Iniciando backup..."

if pg_dump "$DATABASE_URL" | gzip > "$FILE"; then
  # Borrar backups más viejos que RETENTION_DAYS
  find "$BACKUP_DIR" -name '3cars_backup_*.sql.gz' -type f -mtime +"$RETENTION_DAYS" -delete
  echo "[$(date -Iseconds)] Backup OK: $FILE"
else
  echo "[$(date -Iseconds)] Backup FALLIDO" >&2
  # No dejar archivos vacíos/corruptos
  rm -f "$FILE"
  exit 1
fi
