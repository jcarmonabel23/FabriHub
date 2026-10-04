-- =====================================================================
--  FabriHub · 00202_company.sql
--  Datos de la compañía (tesis 4.2.2.1.6: "definición de los datos de la
--  compañía"). Fila única: id fijo = 1.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.company (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),

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

    updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.company IS 'Datos de la compañía que usa FabriHub (una sola fila)';
COMMENT ON COLUMN public.company.id IS 'Siempre 1: garantiza fila única';
COMMENT ON COLUMN public.company.legal_name IS 'Razón social';
COMMENT ON COLUMN public.company.trade_name IS 'Nombre comercial';
COMMENT ON COLUMN public.company.rif IS 'Registro de Información Fiscal (formato J-12345678-9)';
COMMENT ON COLUMN public.company.address IS 'Dirección fiscal';
COMMENT ON COLUMN public.company.city IS 'Ciudad';
COMMENT ON COLUMN public.company.state IS 'Estado';
COMMENT ON COLUMN public.company.country IS 'País';
COMMENT ON COLUMN public.company.phones IS 'Teléfonos (arreglo JSON de textos)';
COMMENT ON COLUMN public.company.email IS 'Correo de contacto';
COMMENT ON COLUMN public.company.website IS 'Sitio web';
COMMENT ON COLUMN public.company.base_currency_id IS 'Moneda funcional: las tasas de cambio se expresan contra ella';
COMMENT ON COLUMN public.company.is_special_taxpayer IS 'Contribuyente especial designado por el SENIAT';
COMMENT ON COLUMN public.company.is_withholding_agent IS 'Agente de retención de IVA/ISLR: aplica retenciones a sus proveedores';
COMMENT ON COLUMN public.company.fiscal_year_start_month IS 'Mes de inicio del ejercicio fiscal (1-12)';
COMMENT ON COLUMN public.company.metadata IS 'Datos adicionales libres';
COMMENT ON COLUMN public.company.updated_by IS 'Usuario que modificó el registro por última vez';
COMMENT ON COLUMN public.company.created_at IS 'Fecha y hora de creación';
COMMENT ON COLUMN public.company.updated_at IS 'Fecha y hora de la última actualización';

CREATE TRIGGER trg_company_updated_at BEFORE UPDATE ON public.company
    FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();
CREATE TRIGGER trg_audit_company AFTER INSERT OR UPDATE OR DELETE ON public.company
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit();

-- Datos provisionales: se completan desde Parámetros → Empresa.
INSERT INTO public.company (legal_name, rif, base_currency_id)
SELECT 'Empresa Demo, C.A.', 'J-00000000-0', id FROM public.catalogs_currencies WHERE code = 'VES'
ON CONFLICT (id) DO NOTHING;
