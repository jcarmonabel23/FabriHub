-- =====================================================================
--  FabriHub · 00203_parameters.sql
--  Parámetros por módulo (tesis: clases Parámetros + DetalleParametros).
--  Normalización: "Parámetros (1 al 10)" pasa a clave/valor TIPADO.
--  Las DEFINICIONES las fija el código (las lee la API); el usuario solo
--  cambia el VALOR, validado contra data_type y rules.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.parameters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    module_code VARCHAR(40) NOT NULL REFERENCES public.catalogs_modules(code) ON UPDATE CASCADE,
    key VARCHAR(60) NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]*$'),
    name VARCHAR(120) NOT NULL,
    description VARCHAR(400),
    order_list INTEGER NOT NULL DEFAULT 0,

    data_type VARCHAR(10) NOT NULL CHECK (data_type IN ('string', 'integer', 'number', 'boolean', 'select')),
    value JSONB NOT NULL,
    default_value JSONB NOT NULL,
    rules JSONB NOT NULL DEFAULT '{}',

    updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_parameters_module_key UNIQUE (module_code, key)
);

COMMENT ON TABLE public.parameters IS 'Parámetros de configuración por módulo (clave/valor tipado)';
COMMENT ON COLUMN public.parameters.id IS 'Identificador único';
COMMENT ON COLUMN public.parameters.module_code IS 'Módulo raíz al que pertenece (INVENTORY, PURCHASES…)';
COMMENT ON COLUMN public.parameters.key IS 'Clave con que la API lee el parámetro';
COMMENT ON COLUMN public.parameters.name IS 'Nombre visible';
COMMENT ON COLUMN public.parameters.description IS 'Qué controla el parámetro';
COMMENT ON COLUMN public.parameters.order_list IS 'Orden de presentación';
COMMENT ON COLUMN public.parameters.data_type IS 'Tipo del valor: string, integer, number, boolean o select';
COMMENT ON COLUMN public.parameters.value IS 'Valor vigente (JSON del tipo indicado)';
COMMENT ON COLUMN public.parameters.default_value IS 'Valor de fábrica (para restaurar)';
COMMENT ON COLUMN public.parameters.rules IS 'Reglas de validación: min, max, options [{value,label}], maxLength';
COMMENT ON COLUMN public.parameters.updated_by IS 'Usuario que cambió el valor por última vez';
COMMENT ON COLUMN public.parameters.created_at IS 'Fecha y hora de creación';
COMMENT ON COLUMN public.parameters.updated_at IS 'Fecha y hora del último cambio de valor';

CREATE TRIGGER trg_parameters_updated_at BEFORE UPDATE ON public.parameters
    FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();
CREATE TRIGGER trg_audit_parameters AFTER INSERT OR UPDATE OR DELETE ON public.parameters
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit();

INSERT INTO public.parameters (module_code, order_list, key, name, description, data_type, value, default_value, rules) VALUES
    -- Inventario
    ('INVENTORY', 1, 'costing_method', 'Método de costeo',
        'Cómo se valoran entradas y salidas (tesis 2.1.5).', 'select', '"weighted_average"', '"weighted_average"',
        '{"options":[{"value":"weighted_average","label":"Costo promedio ponderado"},{"value":"standard","label":"Costo estándar"}]}'),
    ('INVENTORY', 2, 'allow_negative_stock', 'Permitir existencia negativa',
        'Si está apagado, una salida mayor a la existencia se rechaza.', 'boolean', 'false', 'false', '{}'),
    ('INVENTORY', 3, 'expiry_alert_days', 'Alerta de vencimiento (días)',
        'Días de anticipación para alertar lotes por vencer.', 'integer', '90', '90', '{"min":1,"max":730}'),
    -- Producción
    ('PRODUCTION', 1, 'mrp_horizon_months', 'Horizonte del MRP (meses)',
        'Meses hacia adelante que considera el cálculo de necesidades.', 'integer', '3', '3', '{"min":1,"max":24}'),
    ('PRODUCTION', 2, 'scrap_default_pct', 'Merma por defecto (%)',
        'Porcentaje de merma que se sugiere al crear fórmulas.', 'number', '0', '0', '{"min":0,"max":50}'),
    -- Compras
    ('PURCHASES', 1, 'require_po_approval', 'Las órdenes de compra requieren aprobación',
        'Una OC no se puede recibir hasta que la apruebe alguien distinto a quien la creó.', 'boolean', 'true', 'true', '{}'),
    ('PURCHASES', 2, 'receipt_tolerance_pct', 'Tolerancia de recepción (%)',
        'Cuánto puede excederse la cantidad recibida sobre la pedida.', 'number', '5', '5', '{"min":0,"max":50}'),
    -- Ventas
    ('SALES', 1, 'allow_backorder', 'Permitir pedidos pendientes (backorder)',
        'Si no hay existencia suficiente, la orden queda parcialmente pendiente.', 'boolean', 'true', 'true', '{}'),
    ('SALES', 2, 'enforce_fefo', 'Exigir FEFO en despachos',
        'Obliga a despachar primero los lotes que vencen antes.', 'boolean', 'true', 'true', '{}'),
    -- Calidad
    ('QUALITY', 1, 'quarantine_on_receipt', 'Cuarentena al recibir compras',
        'Los lotes recibidos quedan retenidos hasta que Calidad los libere.', 'boolean', 'true', 'true', '{}'),
    ('QUALITY', 2, 'quarantine_on_production', 'Cuarentena al terminar producción',
        'Los lotes fabricados quedan retenidos hasta que Calidad los libere.', 'boolean', 'true', 'true', '{}'),
    -- Impuestos
    ('TAXES', 1, 'tax_unit_value', 'Valor de la unidad tributaria (Bs.)',
        'Referencia para montos mínimos y sustraendos del ISLR.', 'number', '9', '9', '{"min":0}'),
    ('TAXES', 2, 'apply_withholdings', 'Aplicar retenciones a proveedores',
        'Solo si la empresa es agente de retención.', 'boolean', 'false', 'false', '{}')
ON CONFLICT (module_code, key) DO NOTHING;

-- Lectura tipada desde SQL (para funciones de fases siguientes).
CREATE OR REPLACE FUNCTION public.fn_parameter(p_module VARCHAR, p_key VARCHAR)
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
    SELECT value FROM public.parameters WHERE module_code = p_module AND key = p_key;
$$;

COMMENT ON FUNCTION public.fn_parameter(VARCHAR, VARCHAR) IS 'Valor vigente de un parámetro (JSONB) o NULL si no existe';
