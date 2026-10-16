#!/bin/sh
# Restores a dump into the database given by the PG* variables. DESTRUCTIVE: replaces the current contents.
#   docker compose stop web && docker compose exec -T db sh -c 'pg_restore ...'  (see DEPLOYMENT.md)
set -eu
[ $# -eq 1 ] && [ -f "$1" ] || { echo "usage: $0 <dump-file>" >&2; exit 2; }
echo "This REPLACES the data in database '${PGDATABASE:?}' on '${PGHOST:-local socket}'. Type the database name to continue:"
read -r answer
[ "$answer" = "$PGDATABASE" ] || { echo "aborted"; exit 1; }
pg_restore --clean --if-exists --no-owner --single-transaction --dbname="$PGDATABASE" "$1"
echo "restore finished"
