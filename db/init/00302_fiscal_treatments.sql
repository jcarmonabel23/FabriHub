-- =====================================================================
--  FabriHub · 00302_fiscal_treatments.sql
--  Tratamiento fiscal (tesis 4.2.2.1.5: Clase Tratamiento Fiscal): combina
--  una tarifa de impuesto y, opcionalmente, una de retención, con vigencia.
--  Lo referencian productos, clientes, proveedores y líneas de documentos.
--
--  calc_method decide de dónde sale cada parte al facturar (fases 4 y 6):
--    product → impuesto y retención del tratamiento del PRODUCTO
--    party   → del tratamiento del CLIENTE/PROVEEDOR
--    both    → impuesto del producto, retención del cliente/proveedor
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.fiscal_treatments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    order_list INTEGER NOT NULL DEFAULT 0,

    code VARCHAR(20) NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9_-]+$'),
    name VARCHAR(120) NOT NULL,
    description VARCHAR(400),

    valid_from DATE NOT NULL DEFAULT CURRENT_DATE,
    valid_to DATE,

    tax_rate_id UUID NOT NULL REFERENCES public.taxes_rates(id) ON DELETE RESTRICT,
    withholding_rate_id UUID REFERENCES public.withholdings_rates(id) ON DELETE RESTRICT,
    calc_method VARCHAR(10) NOT NULL DEFAULT 'product' CHECK (calc_method IN ('product', 'party', 'both')),

    metadata JSONB NOT NULL DEFAULT '{}',

    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT ck_fiscal_treatments_validity CHECK (valid_to IS NULL OR valid_to >= valid_from)
);

COMMENT ON TABLE public.fiscal_treatments IS 'Tratamientos fiscales: tarifa de impuesto + tarifa de retención con vigencia';
COMMENT ON COLUMN public.fiscal_treatments.id IS 'Identificador único';
COMMENT ON COLUMN public.fiscal_treatments.is_active IS 'Indica si el tratamiento está activo';
COMMENT ON COLUMN public.fiscal_treatments.order_list IS 'Orden de presentación';
COMMENT ON COLUMN public.fiscal_treatments.code IS 'Código de Tratamiento Fiscal';
COMMENT ON COLUMN public.fiscal_treatments.name IS 'Nombre del tratamiento';
COMMENT ON COLUMN public.fiscal_treatments.description IS 'Descripción';
COMMENT ON COLUMN public.fiscal_treatments.valid_from IS 'Inicio de vigencia (tesis: Fecha Inicio)';
COMMENT ON COLUMN public.fiscal_treatments.valid_to IS 'Fin de vigencia, NULL = indefinida (tesis: Fecha Fin)';
COMMENT ON COLUMN public.fiscal_treatments.tax_rate_id IS 'Tarifa de impuesto (tesis: Código de Impuesto + Código Tarifa)';
COMMENT ON COLUMN public.fiscal_treatments.withholding_rate_id IS 'Tarifa de retención opcional (tesis: Código de Retención + Código Tarifa)';
COMMENT ON COLUMN public.fiscal_treatments.calc_method IS 'Método de cálculo: product, party o both';
COMMENT ON COLUMN public.fiscal_treatments.metadata IS 'Datos adicionales libres';
COMMENT ON COLUMN public.fiscal_treatments.created_by IS 'Usuario que creó el registro';
COMMENT ON COLUMN public.fiscal_treatments.updated_by IS 'Usuario que modificó el registro por última vez';
COMMENT ON COLUMN public.fiscal_treatments.created_at IS 'Fecha y hora de creación';
COMMENT ON COLUMN public.fiscal_treatments.updated_at IS 'Fecha y hora de la última actualización';

CREATE TRIGGER trg_fiscal_treatments_updated_at BEFORE UPDATE ON public.fiscal_treatments
    FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();
CREATE TRIGGER trg_audit_fiscal_treatments AFTER INSERT OR UPDATE OR DELETE ON public.fiscal_treatments
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit();

INSERT INTO public.fiscal_treatments (order_list, code, name, description, valid_from, tax_rate_id, withholding_rate_id, calc_method)
SELECT s.ord, s.code, s.name, s.description, DATE '2026-01-01', tr.id, wr.id, s.calc_method
FROM (VALUES
    (1, 'G16',       'Gravado 16%',                    'Producto gravado con alícuota general',               'IVA', 'G',  NULL,   'product'),
    (2, 'R8',        'Gravado 8%',                     'Producto con alícuota reducida',                      'IVA', 'R',  NULL,   'product'),
    (3, 'EXENTO',    'Exento',                         'Medicamentos y bienes exentos de IVA',                'IVA', 'EX', NULL,   'product'),
    (4, 'G16_RIVA75','Gravado 16% con retención 75%',  'Proveedor ordinario de un agente de retención',       'IVA', 'G',  'R75',  'both'),
    (5, 'G16_RIVA100','Gravado 16% con retención 100%','Proveedor sin RIF válido o con irregularidades',      'IVA', 'G',  'R100', 'both')
) AS s(ord, code, name, description, tax_code, rate_code, wh_rate_code, calc_method)
JOIN public.taxes t ON t.code = s.tax_code
JOIN public.taxes_rates tr ON tr.tax_id = t.id AND tr.code = s.rate_code
LEFT JOIN public.withholdings_rates wr ON wr.code = s.wh_rate_code
ON CONFLICT (code) DO NOTHING;
