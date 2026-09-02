#!/bin/bash
set -euo pipefail

# Instala un cron job para correr backup-db.sh todos los días a las 03:00.
# Debe ejecutarse en el servidor de producción.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CRON_JOB="0 3 * * * cd $BACKEND_DIR && ./scripts/backup-db.sh >> /var/log/3cars-backup.log 2>&1"

echo "Agregando cron job para backup automático..."
echo "Se ejecutará todos los días a las 03:00 hs."

# Evitar duplicados: borrar líneas que apunten al backup-db.sh
( crontab -l 2>/dev/null || true ) | grep -v "backup-db.sh" > /tmp/crontab-3cars.tmp || true

# Agregar el nuevo job
echo "$CRON_JOB" >> /tmp/crontab-3cars.tmp
crontab /tmp/crontab-3cars.tmp
rm -f /tmp/crontab-3cars.tmp

echo "Cron job instalado:"
crontab -l | grep "backup-db.sh"

echo ""
echo "Para probarlo manualmente:"
echo "  $BACKEND_DIR/scripts/backup-db.sh"
