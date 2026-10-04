-- =====================================================================
--  FabriHub · 00200_catalogs_currencies.sql
--  Monedas y tasas de cambio. La moneda base la fija company.base_currency_id;
--  las tasas se expresan en unidades de moneda base por 1 unidad de la moneda.
--  (Tesis: "Código de Moneda" y "Tasa de Cambio" de las órdenes de compra/venta.)
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.catalogs_currencies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    order_list INTEGER NOT NULL DEFAULT 0,

    code CHAR(3) NOT NULL UNIQUE CHECK (code ~ '^[A-Z]{3}$'),
    name VARCHAR(80) NOT NULL,
    description VARCHAR(400),
    symbol VARCHAR(8) NOT NULL,
    decimals SMALLINT NOT NULL DEFAULT 2 CHECK (decimals BETWEEN 0 AND 6),

    metadata JSONB NOT NULL DEFAULT '{}',

    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.catalogs_currencies IS 'Catálogo de monedas (ISO 4217)';
COMMENT ON COLUMN public.catalogs_currencies.id IS 'Identificador único de la moneda';
COMMENT ON COLUMN public.catalogs_currencies.is_active IS 'Indica si la moneda está activa';
COMMENT ON COLUMN public.catalogs_currencies.order_list IS 'Orden de presentación';
COMMENT ON COLUMN public.catalogs_currencies.code IS 'Código ISO 4217 de tres letras (VES, USD, EUR)';
COMMENT ON COLUMN public.catalogs_currencies.name IS 'Nombre de la moneda';
COMMENT ON COLUMN public.catalogs_currencies.description IS 'Descripción opcional';
COMMENT ON COLUMN public.catalogs_currencies.symbol IS 'Símbolo para mostrar montos (Bs., $, €)';
COMMENT ON COLUMN public.catalogs_currencies.decimals IS 'Decimales con que se expresan los montos';
COMMENT ON COLUMN public.catalogs_currencies.metadata IS 'Datos adicionales libres';
COMMENT ON COLUMN public.catalogs_currencies.created_by IS 'Usuario que creó el registro';
COMMENT ON COLUMN public.catalogs_currencies.updated_by IS 'Usuario que modificó el registro por última vez';
COMMENT ON COLUMN public.catalogs_currencies.created_at IS 'Fecha y hora de creación del registro';
COMMENT ON COLUMN public.catalogs_currencies.updated_at IS 'Fecha y hora de la última actualización del registro';

CREATE TRIGGER trg_catalogs_currencies_updated_at BEFORE UPDATE ON public.catalogs_currencies
    FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();
CREATE TRIGGER trg_audit_catalogs_currencies AFTER INSERT OR UPDATE OR DELETE ON public.catalogs_currencies
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit();

INSERT INTO public.catalogs_currencies (order_list, code, name, symbol, decimals) VALUES
    (1, 'VES', 'Bolívar digital', 'Bs.', 2),
    (2, 'USD', 'Dólar estadounidense', '$', 2),
    (3, 'EUR', 'Euro', '€', 2)
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------
-- Tasas de cambio por fecha (histórico; cada documento guarda la tasa usada).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.currencies_rates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    currency_id UUID NOT NULL REFERENCES public.catalogs_currencies(id) ON DELETE CASCADE,
    rate_date DATE NOT NULL,
    rate NUMERIC(20, 8) NOT NULL CHECK (rate > 0),
    source VARCHAR(60),

    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_currencies_rates_day UNIQUE (currency_id, rate_date)
);

COMMENT ON TABLE public.currencies_rates IS 'Tasas de cambio históricas: unidades de moneda base por 1 unidad de la moneda';
COMMENT ON COLUMN public.currencies_rates.id IS 'Identificador de la tasa';
COMMENT ON COLUMN public.currencies_rates.currency_id IS 'Moneda a la que aplica';
COMMENT ON COLUMN public.currencies_rates.rate_date IS 'Fecha de vigencia (una tasa por día)';
COMMENT ON COLUMN public.currencies_rates.rate IS 'Unidades de moneda base por 1 unidad de esta moneda';
COMMENT ON COLUMN public.currencies_rates.source IS 'Fuente de la tasa (p. ej. BCV)';
COMMENT ON COLUMN public.currencies_rates.created_by IS 'Usuario que registró la tasa';
COMMENT ON COLUMN public.currencies_rates.created_at IS 'Fecha y hora de registro';

CREATE TRIGGER trg_audit_currencies_rates AFTER INSERT OR UPDATE OR DELETE ON public.currencies_rates
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit();
