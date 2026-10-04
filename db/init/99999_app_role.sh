#!/bin/sh
# =====================================================================
#  FabriHub · 99999_app_role.sh
#  Crea el rol que usa la API: sólo DML + EXECUTE, nunca DDL.
#  Se ejecuta de último para que los GRANT cubran todas las tablas.
# =====================================================================
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  DO \$\$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${APP_DB_USER}') THEN
      CREATE ROLE ${APP_DB_USER} LOGIN PASSWORD '${APP_DB_PASSWORD}'
        NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
    END IF;
  END
  \$\$;

  REVOKE ALL ON DATABASE ${POSTGRES_DB} FROM PUBLIC;
  GRANT CONNECT ON DATABASE ${POSTGRES_DB} TO ${APP_DB_USER};
  REVOKE CREATE ON SCHEMA public FROM PUBLIC;
  GRANT USAGE ON SCHEMA public TO ${APP_DB_USER};

  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_DB_USER};
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${APP_DB_USER};
  GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ${APP_DB_USER};

  ALTER DEFAULT PRIVILEGES FOR ROLE ${POSTGRES_USER} IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${APP_DB_USER};
  ALTER DEFAULT PRIVILEGES FOR ROLE ${POSTGRES_USER} IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO ${APP_DB_USER};
  ALTER DEFAULT PRIVILEGES FOR ROLE ${POSTGRES_USER} IN SCHEMA public
    GRANT EXECUTE ON FUNCTIONS TO ${APP_DB_USER};

  -- Bitácoras inmutables: la app puede insertar y leer, nunca modificar ni borrar.
  REVOKE UPDATE, DELETE, TRUNCATE ON public.audit_log          FROM ${APP_DB_USER};
  REVOKE UPDATE, DELETE, TRUNCATE ON public.users_auth_history FROM ${APP_DB_USER};
  REVOKE UPDATE, DELETE, TRUNCATE ON public.trace_api_logs     FROM ${APP_DB_USER};

  -- El catálogo de permisos lo define el código (los slugs que consultan front y API):
  -- la app solo lo lee.
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.catalogs_permissions FROM ${APP_DB_USER};
EOSQL
