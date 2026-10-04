-- =====================================================================
--  FabriHub · 00300_taxes.sql
--  Impuestos y sus tarifas (tesis 4.2.2.1.5: Clases Impuestos y Tarifa de
--  Impuestos). Relación de agregación: un impuesto tiene 1..N tarifas.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.taxes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    order_list INTEGER NOT NULL DEFAULT 0,

    code VARCHAR(20) NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9_-]+$'),
    name VARCHAR(80) NOT NULL,
    description VARCHAR(400),
    kind VARCHAR(10) NOT NULL DEFAULT 'vat' CHECK (kind IN ('vat', 'luxury', 'other')),

    metadata JSONB NOT NULL DEFAULT '{}',

    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.taxes IS 'Impuestos (tesis: Clase Impuestos)';
COMMENT ON COLUMN public.taxes.id IS 'Identificador único';
COMMENT ON COLUMN public.taxes.is_active IS 'Indica si el impuesto está activo';
COMMENT ON COLUMN public.taxes.order_list IS 'Orden de presentación';
COMMENT ON COLUMN public.taxes.code IS 'Código del impuesto (tesis: Código de Impuestos)';
COMMENT ON COLUMN public.taxes.name IS 'Nombre del impuesto';
COMMENT ON COLUMN public.taxes.description IS 'Descripción';
COMMENT ON COLUMN public.taxes.kind IS 'Naturaleza: vat (IVA), luxury (alícuota adicional de lujo) u other';
COMMENT ON COLUMN public.taxes.metadata IS 'Datos adicionales libres';
COMMENT ON COLUMN public.taxes.created_by IS 'Usuario que creó el registro';
COMMENT ON COLUMN public.taxes.updated_by IS 'Usuario que modificó el registro por última vez';
COMMENT ON COLUMN public.taxes.created_at IS 'Fecha y hora de creación';
COMMENT ON COLUMN public.taxes.updated_at IS 'Fecha y hora de la última actualización';

CREATE TABLE IF NOT EXISTS public.taxes_rates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    tax_id UUID NOT NULL REFERENCES public.taxes(id) ON DELETE CASCADE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    order_list INTEGER NOT NULL DEFAULT 0,

    code VARCHAR(20) NOT NULL CHECK (code ~ '^[A-Z0-9_-]+$'),
    name VARCHAR(80) NOT NULL,
    rate NUMERIC(7, 4) NOT NULL CHECK (rate BETWEEN 0 AND 100),
    account VARCHAR(30),

    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_taxes_rates_code UNIQUE (tax_id, code)
);

COMMENT ON TABLE public.taxes_rates IS 'Tarifas (alícuotas) de cada impuesto (tesis: Clase Tarifa de Impuestos)';
COMMENT ON COLUMN public.taxes_rates.id IS 'Identificador único';
COMMENT ON COLUMN public.taxes_rates.tax_id IS 'Impuesto al que pertenece la tarifa';
COMMENT ON COLUMN public.taxes_rates.is_active IS 'Indica si la tarifa está activa';
COMMENT ON COLUMN public.taxes_rates.order_list IS 'Orden de presentación';
COMMENT ON COLUMN public.taxes_rates.code IS 'Código de la tarifa, único dentro del impuesto';
COMMENT ON COLUMN public.taxes_rates.name IS 'Nombre de la tarifa (General, Reducida, Exenta…)';
COMMENT ON COLUMN public.taxes_rates.rate IS 'Porcentaje del impuesto (0-100)';
COMMENT ON COLUMN public.taxes_rates.account IS 'Cuenta contable del impuesto (tesis: Cuenta Impuestos)';
COMMENT ON COLUMN public.taxes_rates.created_by IS 'Usuario que creó el registro';
COMMENT ON COLUMN public.taxes_rates.updated_by IS 'Usuario que modificó el registro por última vez';
COMMENT ON COLUMN public.taxes_rates.created_at IS 'Fecha y hora de creación';
COMMENT ON COLUMN public.taxes_rates.updated_at IS 'Fecha y hora de la última actualización';

CREATE INDEX IF NOT EXISTS idx_taxes_rates_tax ON public.taxes_rates (tax_id);

CREATE TRIGGER trg_taxes_updated_at BEFORE UPDATE ON public.taxes FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();
CREATE TRIGGER trg_taxes_rates_updated_at BEFORE UPDATE ON public.taxes_rates FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();
CREATE TRIGGER trg_audit_taxes AFTER INSERT OR UPDATE OR DELETE ON public.taxes FOR EACH ROW EXECUTE FUNCTION public.fn_audit();
CREATE TRIGGER trg_audit_taxes_rates AFTER INSERT OR UPDATE OR DELETE ON public.taxes_rates FOR EACH ROW EXECUTE FUNCTION public.fn_audit();

-- Valores de referencia de Venezuela. Verificar contra la normativa vigente antes de usar en producción.
INSERT INTO public.taxes (order_list, code, name, description, kind) VALUES
    (1, 'IVA', 'Impuesto al Valor Agregado', 'Alícuotas general, reducida y exenta', 'vat'),
    (2, 'LUJO', 'Alícuota adicional (bienes suntuarios)', 'Se suma a la alícuota general del IVA', 'luxury')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.taxes_rates (tax_id, order_list, code, name, rate, account)
SELECT t.id, r.ord, r.code, r.name, r.rate, r.account
FROM (VALUES
    ('IVA',  1, 'G',  'General',   16.0000, '2.1.04.01'),
    ('IVA',  2, 'R',  'Reducida',   8.0000, '2.1.04.02'),
    ('IVA',  3, 'EX', 'Exenta',     0.0000, NULL),
    ('LUJO', 1, 'AD', 'Adicional', 15.0000, '2.1.04.03')
) AS r(tax_code, ord, code, name, rate, account)
JOIN public.taxes t ON t.code = r.tax_code
ON CONFLICT (tax_id, code) DO NOTHING;
