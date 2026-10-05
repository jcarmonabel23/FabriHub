#!/bin/sh
# =====================================================================
#  FabriHub · despliegue / actualización en el servidor
#    sh scripts/deploy/deploy.sh
#  Trae lo último de la rama, reconstruye y levanta en modo producción. Los datos (volumen de la BD,
#  certificados de Caddy y ./backups) se conservan; las migraciones nuevas se aplican solas.
# =====================================================================
set -e
cd "$(dirname "$0")/../.."

if [ ! -f .env.production ]; then
  echo "✘ Falta .env.production (cp .env.production.example .env.production y complételo)"
  exit 1
fi
if grep -q "CAMBIAR" .env.production; then
  echo "✘ .env.production todavía tiene valores «CAMBIAR»:"
  grep -n "CAMBIAR" .env.production
  exit 1
fi

COMPOSE="docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env.production"

echo "▶ Actualizando el código…"
git pull --ff-only

echo "▶ Construyendo y levantando…"
$COMPOSE up -d --build --remove-orphans
docker image prune -f >/dev/null

$COMPOSE ps
DOMAIN=$(grep '^DOMAIN=' .env.production | cut -d= -f2-)
echo
echo "✔ FabriHub en https://$DOMAIN  (el primer certificado puede tardar un minuto)"
echo "   Registros:  $COMPOSE logs -f api caddy"
