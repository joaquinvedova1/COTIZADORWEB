#!/bin/bash
# Recrea la base SIMULADA local `rateos_synth` (Postgres 16 del contenedor,
# NUNCA Supabase) con el andamiaje mínimo de Supabase y todas las migraciones.
# Uso: supabase/tests/local/reset.sh [carpeta del repo]
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
REPO="${1:-$(cd "$DIR/../../.." && pwd)}"
P="runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -q"
$P -d postgres -c "drop database if exists rateos_synth with (force);" -c "create database rateos_synth;"
$P -d rateos_synth < "$DIR/scaffold.sql"
for f in "$REPO"/supabase/migrations/*.sql; do
  echo "== $(basename "$f")"
  $P -d rateos_synth < "$f" 2>&1 | grep -v "SET LOCAL can only be used" || true
done
