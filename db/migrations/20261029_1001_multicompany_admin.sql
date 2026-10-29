-- =====================================================================
--  FabriHub · 20261029_1001_multicompany_admin.sql   (fase 10: multiempresa, administración)
--
--  · users.is_platform_admin: administra la plataforma (empresas, roles, módulos y los
--    datos globales). El resto administra solo dentro de sus empresas.
--  · catalogs_modules.scope:
--      company  → datos de cada empresa (lo normal)
--      global   → datos compartidos por todas: los administradores de empresa solo leen
--      platform → pantallas de la plataforma: solo las ve un administrador de plataforma
--  · Módulo ADM_COMPANIES (Seguridad → Empresas).
--  · fn_company_init(): siembra una empresa nueva con la configuración de otra.
-- =====================================================================

-- --------------------------------------------------------------- Administrador de plataforma
ALTER TABLE public.users ADD COLUMN is_platform_admin BOOLEAN NOT NULL DEFAULT FALSE;
COMMENT ON COLUMN public.users.is_platform_admin IS 'Administra la plataforma: empresas, roles, módulos y datos globales (impuestos, monedas, unidades…)';

-- --------------------------------------------------------------- Alcance de los módulos
ALTER TABLE public.catalogs_modules
    ADD COLUMN scope VARCHAR(10) NOT NULL DEFAULT 'company' CHECK (scope IN ('company', 'global', 'platform'));
COMMENT ON COLUMN public.catalogs_modules.scope IS
    'company: datos de cada empresa · global: compartidos, un administrador de empresa solo lee · platform: solo administradores de plataforma';

UPDATE public.catalogs_modules SET scope = 'global' WHERE code IN ('TAX_TAXES', 'TAX_WITHHOLDINGS', 'TAX_TREATMENTS');
UPDATE public.catalogs_modules SET scope = 'platform' WHERE code IN ('ADM_ROLES', 'ADM_MODULES');

INSERT INTO public.catalogs_modules (order_list, code, name, description, icon, path, module_parent_id, scope, metadata)
SELECT 0, 'ADM_COMPANIES', 'Empresas', 'Empresas registradas, sus datos y quién accede a cada una.', 'building',
       '/admin/companies', id, 'platform', '{"phase": 10}'
  FROM public.catalogs_modules WHERE code = 'ADMIN'
ON CONFLICT (code) DO NOTHING;

-- --------------------------------------------------------------- Plantilla de empresa nueva
-- Copia la configuración base de p_template a p_company (recién creada, sin datos):
-- parámetros (con su valor por defecto), correlativos (desde 1) y catálogos comerciales,
-- de inventario y de producción. Los datos operativos (almacenes, productos…) no se copian.
-- SECURITY DEFINER: lee la plantilla sin RLS; solo actúa sobre una empresa sin parámetros.
CREATE OR REPLACE FUNCTION public.fn_company_init(p_company UUID, p_template UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    t TEXT;
    v_cols TEXT;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = p_company) OR NOT EXISTS (SELECT 1 FROM public.companies WHERE id = p_template) THEN
        RAISE EXCEPTION 'Empresa inexistente' USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM public.parameters WHERE company_id = p_company) THEN
        RAISE EXCEPTION 'La empresa ya fue inicializada' USING ERRCODE = 'P0001';
    END IF;

    FOREACH t IN ARRAY ARRAY['parameters', 'document_sequences',
                             'catalogs_payment_terms', 'catalogs_delivery_terms', 'catalogs_delivery_methods',
                             'catalogs_business_types', 'catalogs_zones',
                             'catalogs_product_families', 'catalogs_product_categories',
                             'stages', 'catalogs_work_center_types'] LOOP
        SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO v_cols
          FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = t
           AND column_name NOT IN ('id', 'company_id', 'created_by', 'updated_by', 'created_at', 'updated_at');
        EXECUTE format('INSERT INTO public.%1$I (company_id, %2$s) SELECT $1, %2$s FROM public.%1$I WHERE company_id = $2', t, v_cols)
          USING p_company, p_template;
    END LOOP;

    UPDATE public.parameters SET value = default_value WHERE company_id = p_company;
    UPDATE public.document_sequences SET next_number = 1 WHERE company_id = p_company;
END;
$$;

COMMENT ON FUNCTION public.fn_company_init(UUID, UUID) IS 'Siembra una empresa nueva con la configuración base (parámetros, correlativos, catálogos) de otra';
