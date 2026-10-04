#!/bin/sh
# =====================================================================
#  FabriHub · db/migrate.sh
#  Aplica db/migrations/*.sql en orden, una sola vez cada una, cada una en
#  su propia transacción. Registra versión + checksum en schema_migrations.
#
#  · Línea base: db/init (fases 0-2) corre solo con el volumen vacío.
#  · Desde la fase 3, todo cambio de esquema es una migración NUEVA: nunca
#    se edita una ya aplicada (el checksum lo detecta y aborta el arranque).
#  · En el SQL, :"app_user" es el rol de la aplicación (para GRANT/REVOKE).
# =====================================================================
set -eu

export PGPASSWORD="$POSTGRES_PASSWORD"
export PGOPTIONS="-c client_min_messages=warning"
PSQL="psql -v ON_ERROR_STOP=1 -X -q -h db -U $POSTGRES_USER -d $POSTGRES_DB -v app_user=$APP_DB_USER"

# Por TCP solo responde el servidor definitivo (durante initdb escucha solo en socket local),
# así que esperar aquí garantiza que la línea base ya terminó.
i=0
until $PSQL -tAc "SELECT 1 FROM pg_roles WHERE rolname = '$APP_DB_USER'" 2>/dev/null | grep -q 1; do
  i=$((i + 1))
  if [ "$i" -gt 60 ]; then echo "[migrate] la base de datos no respondió" >&2; exit 1; fi
  sleep 2
done

$PSQL -c "CREATE TABLE IF NOT EXISTS public.schema_migrations (
  version VARCHAR(120) PRIMARY KEY,
  checksum CHAR(64) NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE public.schema_migrations IS 'Migraciones aplicadas (db/migrations) con su checksum SHA-256';"

applied=0
for file in $(ls /migrations/*.sql 2>/dev/null | sort); do
  version=$(basename "$file" .sql)
  sum=$(sha256sum "$file" | cut -d' ' -f1)
  stored=$($PSQL -tAc "SELECT checksum FROM public.schema_migrations WHERE version = '$version'")

  if [ -n "$stored" ]; then
    if [ "$stored" != "$sum" ]; then
      echo "[migrate] ERROR: $version ya fue aplicada y su contenido cambió." >&2
      echo "[migrate] No edite migraciones aplicadas: cree una nueva con la corrección." >&2
      exit 1
    fi
    continue
  fi

  echo "[migrate] aplicando $version"
  $PSQL -1 -f "$file" -c "INSERT INTO public.schema_migrations (version, checksum) VALUES ('$version', '$sum')"
  applied=$((applied + 1))
done

echo "[migrate] listo: $applied migración(es) nueva(s)"
