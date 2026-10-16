#!/bin/sh
# Writes a compressed pg_dump every INTERVAL_SECONDS and deletes dumps older than KEEP_DAYS.
# Uses the standard PG* environment variables. Restore: see DEPLOYMENT.md (deploy/restore.sh).
set -eu
umask 077 # dumps contain personal and health data: owner-only
: "${BACKUP_DIR:=/backups}" "${KEEP_DAYS:=14}" "${INTERVAL_SECONDS:=86400}"
mkdir -p "$BACKUP_DIR"

backup_once() {
  file="$BACKUP_DIR/dienstplan-$(date -u +%Y-%m-%d-%H%M%S).dump"
  if pg_dump --format=custom --no-owner --file="$file.partial"; then
    mv "$file.partial" "$file"
    echo "backup written: $file ($(wc -c < "$file") bytes)"
  else
    rm -f "$file.partial"
    echo "BACKUP FAILED" >&2
    return 1
  fi
  find "$BACKUP_DIR" -name 'dienstplan-*.dump' -mtime +"$KEEP_DAYS" -print -delete
}

# ONCE=1 is used for manual backups and tests
if [ "${ONCE:-0}" = "1" ]; then backup_once; exit $?; fi
while true; do
  backup_once || true # keep trying at the next interval
  sleep "$INTERVAL_SECONDS"
done
