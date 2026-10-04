-- =====================================================================
--  FabriHub · 00301_withholdings.sql
--  Retenciones, tarifas y tramos (tesis 4.2.2.1.5: Clases Retención y
--  Tarifa de Retención).
--  Normalización: "Monto Base / Sustraendo / Tarifa (1 al 4)" se convierte
--  en filas de withholdings_brackets, sin límite de tramos.
--
--  Cálculo (api/src/modules/taxes/engine.ts):
--    base      = monto del documento (base_on='amount', ISLR) o el impuesto (base_on='tax', IVA)
--    tramo     = el de mayor from_amount <= base
--    retención = max(0, base × rate% − subtrahend)
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.withholdings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    order_list INTEGER NOT NULL DEFAULT 0,

    code VARCHAR(20) NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9_-]+$'),
    name VARCHAR(80) NOT NULL,
    description VARCHAR(400),
    kind VARCHAR(10) NOT NULL CHECK (kind IN ('vat', 'income', 'other')),
    base_on VARCHAR(10) NOT NULL CHECK (base_on IN ('amount', 'tax')),

    metadata JSONB NOT NULL DEFAULT '{}',

    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.withholdings IS 'Retenciones (tesis: Clase Retención)';
COMMENT ON COLUMN public.withholdings.id IS 'Identificador único';
COMMENT ON COLUMN public.withholdings.is_active IS 'Indica si la retención está activa';
COMMENT ON COLUMN public.withholdings.order_list IS 'Orden de presentación';
COMMENT ON COLUMN public.withholdings.code IS 'Código de la retención';
COMMENT ON COLUMN public.withholdings.name IS 'Nombre de la retención';
COMMENT ON COLUMN public.withholdings.description IS 'Descripción';
COMMENT ON COLUMN public.withholdings.kind IS 'Naturaleza: vat (retención de IVA), income (ISLR) u other';
COMMENT ON COLUMN public.withholdings.base_on IS 'Sobre qué se calcula: amount (monto del documento) o tax (impuesto causado)';
COMMENT ON COLUMN public.withholdings.metadata IS 'Datos adicionales libres';
COMMENT ON COLUMN public.withholdings.created_by IS 'Usuario que creó el registro';
COMMENT ON COLUMN public.withholdings.updated_by IS 'Usuario que modificó el registro por última vez';
COMMENT ON COLUMN public.withholdings.created_at IS 'Fecha y hora de creación';
COMMENT ON COLUMN public.withholdings.updated_at IS 'Fecha y hora de la última actualización';

CREATE TABLE IF NOT EXISTS public.withholdings_rates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    withholding_id UUID NOT NULL REFERENCES public.withholdings(id) ON DELETE CASCADE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    order_list INTEGER NOT NULL DEFAULT 0,

    code VARCHAR(20) NOT NULL CHECK (code ~ '^[A-Z0-9_-]+$'),
    name VARCHAR(120) NOT NULL,
    account VARCHAR(30),

    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_withholdings_rates_code UNIQUE (withholding_id, code)
);

COMMENT ON TABLE public.withholdings_rates IS 'Tarifas de retención (tesis: Clase Tarifa de Retención); sus montos viven en withholdings_brackets';
COMMENT ON COLUMN public.withholdings_rates.id IS 'Identificador único';
COMMENT ON COLUMN public.withholdings_rates.withholding_id IS 'Retención a la que pertenece';
COMMENT ON COLUMN public.withholdings_rates.is_active IS 'Indica si la tarifa está activa';
COMMENT ON COLUMN public.withholdings_rates.order_list IS 'Orden de presentación';
COMMENT ON COLUMN public.withholdings_rates.code IS 'Código de la tarifa, único dentro de la retención';
COMMENT ON COLUMN public.withholdings_rates.name IS 'Concepto de la tarifa (p. ej. Honorarios profesionales)';
COMMENT ON COLUMN public.withholdings_rates.account IS 'Cuenta contable de la retención (tesis: Cuenta Retención)';
COMMENT ON COLUMN public.withholdings_rates.created_by IS 'Usuario que creó el registro';
COMMENT ON COLUMN public.withholdings_rates.updated_by IS 'Usuario que modificó el registro por última vez';
COMMENT ON COLUMN public.withholdings_rates.created_at IS 'Fecha y hora de creación';
COMMENT ON COLUMN public.withholdings_rates.updated_at IS 'Fecha y hora de la última actualización';

CREATE TABLE IF NOT EXISTS public.withholdings_brackets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    withholding_rate_id UUID NOT NULL REFERENCES public.withholdings_rates(id) ON DELETE CASCADE,
    from_amount NUMERIC(20, 2) NOT NULL DEFAULT 0 CHECK (from_amount >= 0),
    rate NUMERIC(7, 4) NOT NULL CHECK (rate BETWEEN 0 AND 100),
    subtrahend NUMERIC(20, 2) NOT NULL DEFAULT 0 CHECK (subtrahend >= 0),

    CONSTRAINT uq_withholdings_brackets_from UNIQUE (withholding_rate_id, from_amount)
);

COMMENT ON TABLE public.withholdings_brackets IS 'Tramos de una tarifa de retención (tesis: Monto Base, Sustraendo y Tarifa 1 al 4)';
COMMENT ON COLUMN public.withholdings_brackets.id IS 'Identificador único';
COMMENT ON COLUMN public.withholdings_brackets.withholding_rate_id IS 'Tarifa de retención a la que pertenece el tramo';
COMMENT ON COLUMN public.withholdings_brackets.from_amount IS 'Monto base mínimo desde el que aplica el tramo';
COMMENT ON COLUMN public.withholdings_brackets.rate IS 'Porcentaje de retención del tramo';
COMMENT ON COLUMN public.withholdings_brackets.subtrahend IS 'Sustraendo que se resta al resultado del tramo';

CREATE INDEX IF NOT EXISTS idx_withholdings_rates_wh ON public.withholdings_rates (withholding_id);

CREATE TRIGGER trg_withholdings_updated_at BEFORE UPDATE ON public.withholdings FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();
CREATE TRIGGER trg_withholdings_rates_updated_at BEFORE UPDATE ON public.withholdings_rates FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();
CREATE TRIGGER trg_audit_withholdings AFTER INSERT OR UPDATE OR DELETE ON public.withholdings FOR EACH ROW EXECUTE FUNCTION public.fn_audit();
CREATE TRIGGER trg_audit_withholdings_rates AFTER INSERT OR UPDATE OR DELETE ON public.withholdings_rates FOR EACH ROW EXECUTE FUNCTION public.fn_audit();
CREATE TRIGGER trg_audit_withholdings_brackets AFTER INSERT OR UPDATE OR DELETE ON public.withholdings_brackets FOR EACH ROW EXECUTE FUNCTION public.fn_audit();

-- Datos de EJEMPLO para la demostración. Verificar porcentajes, mínimos y sustraendos vigentes.
INSERT INTO public.withholdings (order_list, code, name, description, kind, base_on) VALUES
    (1, 'RIVA', 'Retención de IVA', 'Porcentaje del IVA causado que retiene el agente de retención', 'vat', 'tax'),
    (2, 'ISLR', 'Retención de ISLR', 'Retención sobre pagos según concepto', 'income', 'amount')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.withholdings_rates (withholding_id, order_list, code, name, account)
SELECT w.id, r.ord, r.code, r.name, r.account
FROM (VALUES
    ('RIVA', 1, 'R75',     'Retención 75% del IVA',                                 '1.1.05.01'),
    ('RIVA', 2, 'R100',    'Retención 100% del IVA',                                '1.1.05.01'),
    ('ISLR', 1, 'SERV_PJ', 'Servicios a persona jurídica domiciliada (ejemplo)',    '2.1.05.01'),
    ('ISLR', 2, 'TARIFA2', 'Escala progresiva por tramos (ejemplo, UT = 9 Bs.)',    '2.1.05.01')
) AS r(wh_code, ord, code, name, account)
JOIN public.withholdings w ON w.code = r.wh_code
ON CONFLICT (withholding_id, code) DO NOTHING;

INSERT INTO public.withholdings_brackets (withholding_rate_id, from_amount, rate, subtrahend)
SELECT wr.id, b.from_amount, b.rate, b.subtrahend
FROM (VALUES
    ('R75',      0.00, 75.0000,    0.00),
    ('R100',     0.00, 100.0000,   0.00),
    ('SERV_PJ',  0.00,  2.0000,    0.00),
    ('TARIFA2',     0.00,  6.0000,    0.00),
    ('TARIFA2',  9000.00,  9.0000,  270.00),
    ('TARIFA2', 13500.00, 12.0000,  675.00),
    ('TARIFA2', 18000.00, 16.0000, 1395.00),
    ('TARIFA2', 22500.00, 20.0000, 2295.00),
    ('TARIFA2', 27000.00, 24.0000, 3375.00),
    ('TARIFA2', 36000.00, 29.0000, 5175.00),
    ('TARIFA2', 54000.00, 34.0000, 7875.00)
) AS b(rate_code, from_amount, rate, subtrahend)
JOIN public.withholdings_rates wr ON wr.code = b.rate_code
ON CONFLICT (withholding_rate_id, from_amount) DO NOTHING;
