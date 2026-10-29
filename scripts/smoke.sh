#!/bin/sh
# Ejecuta las pruebas de humo (todas las fases) dentro de la red de la app (la API no se publica al host).
# Requiere: docker compose up -d db api mailpit   y una BD recién creada (docker compose down -v).
# Para otro proyecto de compose: SMOKE_NETWORK=<proyecto>_red_app SMOKE_DB=<contenedor de la BD>
set -e
cd "$(dirname "$0")/.."
ADMIN_EMAIL=$(grep '^ADMIN_EMAIL=' .env | cut -d= -f2-)
ADMIN_INITIAL_PASSWORD=$(grep '^ADMIN_INITIAL_PASSWORD=' .env | cut -d= -f2-)
POSTGRES_USER=$(grep '^POSTGRES_USER=' .env | cut -d= -f2-)
POSTGRES_DB=$(grep '^POSTGRES_DB=' .env | cut -d= -f2-)
APP_DB_USER=$(grep '^APP_DB_USER=' .env | cut -d= -f2-)

# Aislamiento entre empresas (fase 9): directo en la BD, con el rol de la app; se deshace al terminar
echo "════════ Multiempresa"
docker exec -i "${SMOKE_DB:-fabrihub-db}" psql -q -v ON_ERROR_STOP=1 -v app_user="$APP_DB_USER" \
  -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f - < scripts/smoke/tenant-isolation.sql

MSYS_NO_PATHCONV=1 docker run --rm --network "${SMOKE_NETWORK:-fabrihub_red_app}" \
  -e ADMIN_EMAIL="$ADMIN_EMAIL" -e ADMIN_INITIAL_PASSWORD="$ADMIN_INITIAL_PASSWORD" \
  -v "$(pwd)/scripts:/scripts:ro" node:22-alpine node /scripts/smoke/index.mjs
