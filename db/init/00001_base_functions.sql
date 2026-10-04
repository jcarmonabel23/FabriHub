-- =====================================================================
--  FabriHub · 00001_base_functions.sql
--  Funciones utilitarias compartidas por todas las tablas.
-- =====================================================================

-- Mantiene updated_at al día en cada UPDATE (se engancha con un trigger por tabla).
CREATE OR REPLACE FUNCTION public.fn_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.fn_set_updated_at() IS 'Trigger BEFORE UPDATE: actualiza updated_at con la hora actual';

-- Usuario de FabriHub que ejecuta la transacción. La API lo fija con
-- set_config('app.user_id', ..., true) al abrir cada transacción (api/src/db.ts).
CREATE OR REPLACE FUNCTION public.fn_current_app_user()
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
    SELECT NULLIF(current_setting('app.user_id', true), '')::uuid;
$$;

COMMENT ON FUNCTION public.fn_current_app_user() IS 'Usuario de FabriHub fijado por la API en la transacción (app.user_id), o NULL';
