-- =====================================================================
--  FabriHub · 20261028_0901_multicompany.sql   (fase 9: multiempresa, base de datos)
--
--  Una sola BD compartida; cada fila de negocio lleva company_id y Postgres
--  la aísla con Row Level Security (RLS):
--
--  · companies reemplaza a la tabla de fila única `company`; sus datos pasan
--    a la empresa PRINCIPAL, dueña de todo lo existente.
--  · users_companies: a qué empresas pertenece cada usuario (una por defecto).
--    users_sessions.company_id: empresa activa de la sesión.
--  · La API fija `app.company_id` en cada consulta; fn_current_company() lo lee.
--  · Tablas GLOBALES (seguridad, bitácoras, catálogos del sistema y fiscales):
--    sin company_id. Todas las demás son de EMPRESA y reciben:
--      - company_id NOT NULL DEFAULT fn_current_company()
--      - política RLS: solo se ve y se escribe lo de la empresa activa
--      - FK compuestas (company_id, x) → (company_id, id): un registro jamás
--        referencia datos de otra empresa (las FK ignoran RLS; esto no).
--      - únicos "naturales" (código, RIF, número…) pasan a ser por empresa.
--        Los que ya incluyen una FK a otra tabla de empresa quedan igual:
--        esa FK ya los acota a la empresa.
--  · El dueño de las tablas (migraciones, funciones SECURITY DEFINER) no está
--    sujeto a RLS: esas funciones filtran la empresa de forma explícita.
-- =====================================================================

-- --------------------------------------------------------------- Empresa activa
CREATE OR REPLACE FUNCTION public.fn_current_company()
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
    SELECT NULLIF(current_setting('app.company_id', true), '')::uuid;
$$;

COMMENT ON FUNCTION public.fn_current_company() IS 'Empresa activa fijada por la API (app.company_id), o NULL: sin empresa, RLS no deja ver nada';

-- --------------------------------------------------------------- Empresas
CREATE TABLE IF NOT EXISTS public.companies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(20) NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9_-]+$'),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    legal_name VARCHAR(160) NOT NULL,
    trade_name VARCHAR(120),
    rif VARCHAR(12) NOT NULL CHECK (rif ~ '^[VEJPG]-[0-9]{8}-[0-9]$'),

    address VARCHAR(400),
    city VARCHAR(80),
    state VARCHAR(80),
    country VARCHAR(80) NOT NULL DEFAULT 'Venezuela',
    phones JSONB NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(phones) = 'array'),
    email VARCHAR(200),
    website VARCHAR(200),

    base_currency_id UUID NOT NULL REFERENCES public.catalogs_currencies(id) ON DELETE RESTRICT,
    is_special_taxpayer BOOLEAN NOT NULL DEFAULT FALSE,
    is_withholding_agent BOOLEAN NOT NULL DEFAULT FALSE,
    fiscal_year_start_month SMALLINT NOT NULL DEFAULT 1 CHECK (fiscal_year_start_month BETWEEN 1 AND 12),

    metadata JSONB NOT NULL DEFAULT '{}',

    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.companies IS 'Empresas registradas en FabriHub (multiempresa). Reemplaza a la tabla de fila única company';
COMMENT ON COLUMN public.companies.id IS 'Identificador único de la empresa (valor de app.company_id)';
COMMENT ON COLUMN public.companies.code IS 'Código corto de la empresa';
COMMENT ON COLUMN public.companies.is_active IS 'Empresa activa. Una empresa suspendida no admite sesiones';
COMMENT ON COLUMN public.companies.legal_name IS 'Razón social';
COMMENT ON COLUMN public.companies.trade_name IS 'Nombre comercial';
COMMENT ON COLUMN public.companies.rif IS 'Registro de Información Fiscal (formato J-12345678-9)';
COMMENT ON COLUMN public.companies.address IS 'Dirección fiscal';
COMMENT ON COLUMN public.companies.city IS 'Ciudad';
COMMENT ON COLUMN public.companies.state IS 'Estado';
COMMENT ON COLUMN public.companies.country IS 'País';
COMMENT ON COLUMN public.companies.phones IS 'Teléfonos (arreglo JSON de textos)';
COMMENT ON COLUMN public.companies.email IS 'Correo de contacto';
COMMENT ON COLUMN public.companies.website IS 'Sitio web';
COMMENT ON COLUMN public.companies.base_currency_id IS 'Moneda funcional: las tasas de cambio se expresan contra ella';
COMMENT ON COLUMN public.companies.is_special_taxpayer IS 'Contribuyente especial designado por el SENIAT';
COMMENT ON COLUMN public.companies.is_withholding_agent IS 'Agente de retención de IVA/ISLR: aplica retenciones a sus proveedores';
COMMENT ON COLUMN public.companies.fiscal_year_start_month IS 'Mes de inicio del ejercicio fiscal (1-12)';
COMMENT ON COLUMN public.companies.metadata IS 'Datos adicionales libres';
COMMENT ON COLUMN public.companies.created_by IS 'Usuario que creó el registro';
COMMENT ON COLUMN public.companies.updated_by IS 'Usuario que modificó el registro por última vez';
COMMENT ON COLUMN public.companies.created_at IS 'Fecha y hora de creación';
COMMENT ON COLUMN public.companies.updated_at IS 'Fecha y hora de la última actualización';

CREATE TRIGGER trg_companies_updated_at BEFORE UPDATE ON public.companies
    FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();
CREATE TRIGGER trg_audit_companies AFTER INSERT OR UPDATE OR DELETE ON public.companies
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit();

-- La empresa que existía pasa a ser la PRINCIPAL, dueña de todos los datos actuales.
INSERT INTO public.companies (code, legal_name, trade_name, rif, address, city, state, country, phones, email, website,
                              base_currency_id, is_special_taxpayer, is_withholding_agent, fiscal_year_start_month,
                              metadata, updated_by, created_at, updated_at)
SELECT 'PRINCIPAL', legal_name, trade_name, rif, address, city, state, country, phones, email, website,
       base_currency_id, is_special_taxpayer, is_withholding_agent, fiscal_year_start_month,
       metadata, updated_by, created_at, updated_at
  FROM public.company WHERE id = 1;

DROP TABLE public.company;

-- --------------------------------------------------------------- Usuarios por empresa
CREATE TABLE IF NOT EXISTS public.users_companies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_users_companies UNIQUE (user_id, company_id)
);
CREATE UNIQUE INDEX uq_users_companies_default ON public.users_companies (user_id) WHERE is_default;
CREATE INDEX idx_users_companies_company ON public.users_companies (company_id);

COMMENT ON TABLE public.users_companies IS 'Pertenencia de usuarios a empresas. Los permisos de cada empresa viven en users_modules';
COMMENT ON COLUMN public.users_companies.id IS 'Identificador único de la pertenencia';
COMMENT ON COLUMN public.users_companies.user_id IS 'Usuario';
COMMENT ON COLUMN public.users_companies.company_id IS 'Empresa a la que tiene acceso';
COMMENT ON COLUMN public.users_companies.is_default IS 'Empresa con la que abre sesión (una por usuario)';
COMMENT ON COLUMN public.users_companies.is_active IS 'Acceso activo. Inactivo = no puede entrar a esa empresa';
COMMENT ON COLUMN public.users_companies.created_by IS 'Usuario que creó el registro';
COMMENT ON COLUMN public.users_companies.updated_by IS 'Usuario que modificó el registro por última vez';
COMMENT ON COLUMN public.users_companies.created_at IS 'Fecha y hora de creación';
COMMENT ON COLUMN public.users_companies.updated_at IS 'Fecha y hora de la última actualización';

CREATE TRIGGER trg_users_companies_updated_at BEFORE UPDATE ON public.users_companies
    FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();
CREATE TRIGGER trg_audit_users_companies AFTER INSERT OR UPDATE OR DELETE ON public.users_companies
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit();

INSERT INTO public.users_companies (user_id, company_id, is_default)
SELECT u.id, c.id, TRUE FROM public.users u CROSS JOIN public.companies c WHERE c.code = 'PRINCIPAL';

ALTER TABLE public.users_sessions
    ADD COLUMN company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL;
COMMENT ON COLUMN public.users_sessions.company_id IS 'Empresa activa de la sesión (la API la fija en app.company_id)';
UPDATE public.users_sessions SET company_id = (SELECT id FROM public.companies WHERE code = 'PRINCIPAL');

-- --------------------------------------------------------------- Bitácora de auditoría
ALTER TABLE public.audit_log ADD COLUMN company_id UUID;
COMMENT ON COLUMN public.audit_log.company_id IS 'Empresa del registro auditado (la propia en companies; NULL en las demás tablas globales)';
CREATE INDEX idx_audit_log_company ON public.audit_log (company_id, created_at);

CREATE OR REPLACE FUNCTION public.fn_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_ignored TEXT[] := ARRAY['password_hash', 'failed_attempts', 'locked_until', 'logins',
                              'last_login_at', 'updated_at'];
    v_old JSONB;
    v_new JSONB;
    v_changed TEXT[];
    v_key TEXT;
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
        v_old := to_jsonb(OLD);
        FOREACH v_key IN ARRAY v_ignored LOOP v_old := v_old - v_key; END LOOP;
    END IF;
    IF TG_OP IN ('UPDATE', 'INSERT') THEN
        v_new := to_jsonb(NEW);
        FOREACH v_key IN ARRAY v_ignored LOOP v_new := v_new - v_key; END LOOP;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        SELECT array_agg(n.key ORDER BY n.key)
          INTO v_changed
          FROM jsonb_each(v_new) n
         WHERE n.value IS DISTINCT FROM v_old -> n.key;
        IF v_changed IS NULL THEN
            RETURN NEW;
        END IF;
    END IF;

    INSERT INTO public.audit_log (table_name, record_id, action, old_data, new_data, changed_fields, user_id, trace_id, company_id)
    VALUES (
        TG_TABLE_NAME,
        COALESCE(v_new ->> 'id', v_old ->> 'id'),
        LEFT(TG_OP, 1),
        v_old,
        v_new,
        v_changed,
        public.fn_current_app_user(),
        NULLIF(current_setting('app.trace_id', true), '')::uuid,
        COALESCE(v_new ->> 'company_id', v_old ->> 'company_id',
                 CASE WHEN TG_TABLE_NAME = 'companies' THEN COALESCE(v_new ->> 'id', v_old ->> 'id') END)::uuid
    );

    RETURN COALESCE(NEW, OLD);
END;
$$;

-- --------------------------------------------------------------- Tablas de empresa
DO $$
DECLARE
    -- Todo lo que NO está aquí es de empresa.
    v_global TEXT[] := ARRAY[
        'schema_migrations', 'companies', 'users_companies',
        -- seguridad y bitácoras
        'catalogs_permissions', 'catalogs_roles', 'catalogs_modules',
        'users', 'users_sessions', 'users_otp', 'users_auth_history', 'users_passwords_history',
        'trace_api_logs', 'audit_log', 'metrics_module_usage',
        -- catálogos del sistema (el código depende de sus códigos) y legislación fiscal
        'catalogs_currencies', 'catalogs_units', 'catalogs_product_types',
        'catalogs_movement_types', 'catalogs_movement_concepts',
        'taxes', 'taxes_rates', 'withholdings', 'withholdings_rates', 'withholdings_brackets', 'fiscal_treatments'];
    v_company UUID := (SELECT id FROM public.companies WHERE code = 'PRINCIPAL');
    v_tenant TEXT[];
    t TEXT;
    r RECORD;
    v_cols TEXT[];
    v_on_delete TEXT;
    v_on_update TEXT;
BEGIN
    IF v_company IS NULL THEN
        RAISE EXCEPTION 'No se encontró la empresa PRINCIPAL';
    END IF;

    SELECT array_agg(c.relname::text ORDER BY c.relname) INTO v_tenant
      FROM pg_class c
     WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND c.relname <> ALL (v_global);

    -- FK de empresa a empresa (columna simple → id), antes de tocar nada
    CREATE TEMP TABLE _tenant_fk ON COMMIT DROP AS
    SELECT k.oid, k.conname, c.relname::text AS tbl, a.attname::text AS col, rt.relname::text AS ref,
           k.confdeltype, k.confupdtype, k.condeferrable, k.condeferred
      FROM pg_constraint k
      JOIN pg_class c ON c.oid = k.conrelid
      JOIN pg_class rt ON rt.oid = k.confrelid
      JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
     WHERE k.contype = 'f' AND array_length(k.conkey, 1) = 1
       AND c.relname = ANY (v_tenant) AND rt.relname = ANY (v_tenant);

    -- 1) Columna company_id. El DEFAULT constante rellena las filas existentes sin disparar
    --    triggers (los movimientos contabilizados son inmutables); luego pasa a ser la empresa activa.
    FOREACH t IN ARRAY v_tenant LOOP
        EXECUTE format('ALTER TABLE public.%I ADD COLUMN company_id UUID NOT NULL DEFAULT %L
                        CONSTRAINT %I REFERENCES public.companies(id) ON DELETE RESTRICT',
                       t, v_company, 'fk_' || t || '_company');
        EXECUTE format('ALTER TABLE public.%I ALTER COLUMN company_id SET DEFAULT public.fn_current_company()', t);
        EXECUTE format('CREATE INDEX %I ON public.%I (company_id)', 'idx_' || t || '_company', t);
        EXECUTE format('COMMENT ON COLUMN public.%I.company_id IS %L', t, 'Empresa dueña del registro (aislada por RLS)');
    END LOOP;

    -- 2) Únicos y PK naturales → por empresa (salvo los que ya contienen una FK de empresa).
    --    Se materializan antes de modificarlos.
    CREATE TEMP TABLE _natural_keys ON COMMIT DROP AS
    SELECT k.conname::text AS name, c.relname::text AS tbl, pg_get_constraintdef(k.oid) AS def, TRUE AS is_constraint,
           ARRAY(SELECT a.attname::text FROM pg_attribute a WHERE a.attrelid = k.conrelid AND a.attnum = ANY (k.conkey)) AS cols
      FROM pg_constraint k
      JOIN pg_class c ON c.oid = k.conrelid
     WHERE k.contype IN ('u', 'p') AND c.relname = ANY (v_tenant)
    UNION ALL
    SELECT i.indexrelid::regclass::text, c.relname::text, pg_get_indexdef(i.indexrelid), FALSE,
           ARRAY(SELECT a.attname::text FROM pg_attribute a WHERE a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey::smallint[]))
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indrelid
     WHERE i.indisunique AND NOT i.indisprimary AND c.relname = ANY (v_tenant)
       AND NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conindid = i.indexrelid);

    DELETE FROM _natural_keys n
     WHERE n.cols = ARRAY['id']
        OR 'company_id' = ANY (n.cols)
        OR EXISTS (SELECT 1 FROM _tenant_fk f WHERE f.tbl = n.tbl AND f.col = ANY (n.cols));

    FOR r IN SELECT * FROM _natural_keys ORDER BY tbl, name LOOP
        IF r.is_constraint THEN
            EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', r.tbl, r.name);
            EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I %s', r.tbl, r.name,
                           regexp_replace(r.def, '\(', '(company_id, '));
        ELSE
            EXECUTE format('DROP INDEX %s', r.name);
            EXECUTE regexp_replace(r.def, 'USING (\w+) \(', 'USING \1 (company_id, ');
        END IF;
    END LOOP;

    -- 3) FK compuestas: (company_id, col) → (company_id, id)
    FOR t IN SELECT DISTINCT ref FROM _tenant_fk LOOP
        EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I UNIQUE (company_id, id)', t, 'uq_' || t || '_company_id');
    END LOOP;

    FOR r IN SELECT * FROM _tenant_fk ORDER BY tbl, conname LOOP
        v_on_delete := CASE r.confdeltype
            WHEN 'c' THEN 'CASCADE'
            WHEN 'n' THEN format('SET NULL (%I)', r.col)   -- solo la columna; company_id nunca se anula
            WHEN 'r' THEN 'RESTRICT'
            WHEN 'a' THEN 'NO ACTION'
        END;
        v_on_update := CASE r.confupdtype WHEN 'c' THEN 'CASCADE' WHEN 'r' THEN 'RESTRICT' WHEN 'a' THEN 'NO ACTION' END;
        IF v_on_delete IS NULL OR v_on_update IS NULL THEN
            RAISE EXCEPTION 'FK % de % con acción no soportada (del %, upd %)', r.conname, r.tbl, r.confdeltype, r.confupdtype;
        END IF;
        EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', r.tbl, r.conname);
        EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (company_id, %I)
                        REFERENCES public.%I (company_id, id) ON UPDATE %s ON DELETE %s %s',
                       r.tbl, r.conname, r.col, r.ref, v_on_update, v_on_delete,
                       CASE WHEN r.condeferrable THEN 'DEFERRABLE' || CASE WHEN r.condeferred THEN ' INITIALLY DEFERRED' ELSE '' END ELSE '' END);
    END LOOP;

    -- 4) RLS: la app solo ve y escribe filas de la empresa activa
    FOREACH t IN ARRAY v_tenant LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('CREATE POLICY p_company_isolation ON public.%I
                          USING (company_id = (SELECT public.fn_current_company()))
                          WITH CHECK (company_id = (SELECT public.fn_current_company()))', t);
    END LOOP;
END
$$;

-- --------------------------------------------------------------- Vistas
-- Una vista corre con los privilegios de su dueño (que no está sujeto a RLS):
-- security_invoker hace que respete la empresa de quien consulta.
ALTER VIEW public.v_stock_alerts SET (security_invoker = true);
ALTER VIEW public.v_lots_expiring SET (security_invoker = true);
ALTER VIEW public.v_stock_available SET (security_invoker = true);

CREATE OR REPLACE VIEW public.v_users_effective_permissions WITH (security_invoker = true) AS
SELECT
    um.user_id,
    m.id   AS module_id,
    m.code AS module_code,
    COALESCE(
        (SELECT jsonb_agg(DISTINCT p ORDER BY p)
           FROM (
                SELECT jsonb_array_elements_text(r.permissions) AS p
                  FROM public.catalogs_roles r
                 WHERE r.is_active
                   AND r.id::text IN (SELECT jsonb_array_elements_text(um.role_ids))
                UNION
                SELECT jsonb_array_elements_text(um.permissions)
           ) perms
          WHERE p IN (SELECT slug FROM public.catalogs_permissions WHERE is_active)),
        '[]'::jsonb
    ) AS permissions,
    um.company_id
FROM public.users_modules um
JOIN public.catalogs_modules m ON m.id = um.module_id AND m.is_active
WHERE um.is_active;

COMMENT ON VIEW public.v_users_effective_permissions IS 'Permisos efectivos (unión de roles activos + extras) por usuario, módulo y empresa';

-- --------------------------------------------------------------- Funciones con empresa explícita
-- Pueden ejecutarse dentro de funciones SECURITY DEFINER (sin RLS): filtran la empresa a mano.
CREATE OR REPLACE FUNCTION public.fn_parameter(p_module VARCHAR, p_key VARCHAR)
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
    SELECT value FROM public.parameters
     WHERE module_code = p_module AND key = p_key AND company_id = public.fn_current_company();
$$;

CREATE OR REPLACE FUNCTION public.fn_next_document_number(p_doc_type VARCHAR)
RETURNS VARCHAR
LANGUAGE plpgsql
AS $$
DECLARE
    v_number BIGINT;
    v_prefix VARCHAR;
    v_padding SMALLINT;
BEGIN
    UPDATE public.document_sequences
       SET next_number = next_number + 1
     WHERE doc_type = p_doc_type AND company_id = public.fn_current_company()
    RETURNING next_number - 1, prefix, padding INTO v_number, v_prefix, v_padding;

    IF v_number IS NULL THEN
        RAISE EXCEPTION 'Tipo de documento sin correlativo: %', p_doc_type USING ERRCODE = 'P0001';
    END IF;

    RETURN v_prefix || lpad(v_number::text, v_padding, '0');
END;
$$;

-- Contabilizar / reversar: el núcleo (SECURITY DEFINER) busca el movimiento solo por id.
-- Se renombra y la función pública verifica antes que el movimiento sea de la empresa activa.
ALTER FUNCTION public.fn_post_inventory_movement(UUID) RENAME TO fn__post_inventory_movement;
ALTER FUNCTION public.fn_reverse_inventory_movement(UUID) RENAME TO fn__reverse_inventory_movement;
REVOKE EXECUTE ON FUNCTION public.fn__post_inventory_movement(UUID) FROM PUBLIC, :"app_user";
REVOKE EXECUTE ON FUNCTION public.fn__reverse_inventory_movement(UUID) FROM PUBLIC, :"app_user";

CREATE OR REPLACE FUNCTION public.fn_post_inventory_movement(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.inventory_movements WHERE id = p_id AND company_id = public.fn_current_company()) THEN
        RAISE EXCEPTION 'Movimiento no encontrado' USING ERRCODE = 'P0001';
    END IF;
    PERFORM public.fn__post_inventory_movement(p_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_reverse_inventory_movement(p_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.inventory_movements WHERE id = p_id AND company_id = public.fn_current_company()) THEN
        RAISE EXCEPTION 'Movimiento no encontrado' USING ERRCODE = 'P0001';
    END IF;
    RETURN public.fn__reverse_inventory_movement(p_id);
END;
$$;

COMMENT ON FUNCTION public.fn_post_inventory_movement(UUID) IS 'Contabiliza un movimiento de la empresa activa (única vía para cambiar existencias)';
COMMENT ON FUNCTION public.fn_reverse_inventory_movement(UUID) IS 'Reversa un movimiento contabilizado de la empresa activa';
