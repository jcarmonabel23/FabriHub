#!/bin/sh
# Ejecuta las pruebas de humo (todas las fases) dentro de la red de la app (la API no se publica al host).
# Requiere: docker compose up -d db api mailpit   y una BD recién creada (docker compose down -v).
set -e
cd "$(dirname "$0")/.."
ADMIN_EMAIL=$(grep '^ADMIN_EMAIL=' .env | cut -d= -f2-)
ADMIN_INITIAL_PASSWORD=$(grep '^ADMIN_INITIAL_PASSWORD=' .env | cut -d= -f2-)
MSYS_NO_PATHCONV=1 docker run --rm --network fabrihub_red_app \
  -e ADMIN_EMAIL="$ADMIN_EMAIL" -e ADMIN_INITIAL_PASSWORD="$ADMIN_INITIAL_PASSWORD" \
  -v "$(pwd)/scripts:/scripts:ro" node:22-alpine node /scripts/smoke/index.mjs
