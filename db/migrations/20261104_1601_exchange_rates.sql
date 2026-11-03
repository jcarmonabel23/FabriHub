-- =====================================================================
--  FabriHub · Fase 16 · Tipos de cambio automáticos
--
--  · catalogs_countries.rate_provider: de dónde sale la tasa oficial del país
--    (VE: BCV, lectura de su página; CR: BCCR, API SDDE con token).
--  · currencies_rates: is_automatic (la trajo el proveedor) y value_date (fecha valor que
--    publica la fuente). Una consulta automática NUNCA pisa una tasa cargada a mano.
--  · exchange_rate_runs: bitácora de cada consulta (programada o «Actualizar ahora»).
--  · company_secrets: secretos por empresa (token del BCCR), cifrados por la API (AES-256-GCM);
--    la BD solo guarda el texto cifrado.
--  · Parámetros SETTINGS: actualización automática (apagada hasta que la empresa la active),
--    cada cuántas horas y, en Costa Rica, si se usa la tasa de compra o de venta.
--  · Alerta RATES_FAILED: la última consulta automática falló.
-- =====================================================================

-- --------------------------------------------------------------- Proveedor por país
ALTER TABLE public.catalogs_countries ADD COLUMN rate_provider VARCHAR(10)
    CHECK (rate_provider IN ('BCV', 'BCCR'));
COMMENT ON COLUMN public.catalogs_countries.rate_provider IS 'Proveedor de la tasa oficial: BCV (Venezuela) o BCCR (Costa Rica); NULL = solo carga manual';
UPDATE public.catalogs_countries SET rate_provider = 'BCV' WHERE code = 'VE';
UPDATE public.catalogs_countries SET rate_provider = 'BCCR' WHERE code = 'CR';

-- --------------------------------------------------------------- Tasas: origen automático y fecha valor
ALTER TABLE public.currencies_rates
    ADD COLUMN is_automatic BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN value_date DATE;
COMMENT ON COLUMN public.currencies_rates.is_automatic IS 'TRUE = la registró la consulta automática (se puede actualizar); FALSE = carga manual (no se pisa)';
COMMENT ON COLUMN public.currencies_rates.value_date IS 'Fecha valor publicada por la fuente (BCV/BCCR); NULL en las manuales';

-- --------------------------------------------------------------- Bitácora de consultas
CREATE TABLE public.exchange_rate_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL DEFAULT public.fn_current_company() REFERENCES public.companies(id) ON DELETE RESTRICT,
    provider VARCHAR(10) NOT NULL,
    trigger VARCHAR(10) NOT NULL CHECK (trigger IN ('schedule', 'manual')),
    status VARCHAR(10) NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'ok', 'partial', 'error')),
    message VARCHAR(600),
    rates JSONB NOT NULL DEFAULT '[]',
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ,
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL
);
COMMENT ON TABLE public.exchange_rate_runs IS 'Consultas de tasas al proveedor oficial (BCV/BCCR), programadas o manuales';
COMMENT ON COLUMN public.exchange_rate_runs.provider IS 'BCV o BCCR';
COMMENT ON COLUMN public.exchange_rate_runs.trigger IS 'schedule = tarea periódica; manual = botón «Actualizar ahora»';
COMMENT ON COLUMN public.exchange_rate_runs.status IS 'running, ok, partial (alguna moneda no se registró) o error';
COMMENT ON COLUMN public.exchange_rate_runs.message IS 'Detalle del error o de lo omitido';
COMMENT ON COLUMN public.exchange_rate_runs.rates IS '[{currency, rateDate, valueDate, rate, action: inserted|updated|unchanged|kept_manual}]';
COMMENT ON COLUMN public.exchange_rate_runs.created_by IS 'Usuario que la pidió (NULL en las programadas)';
CREATE INDEX idx_exchange_rate_runs_company ON public.exchange_rate_runs (company_id, started_at DESC);

-- --------------------------------------------------------------- Secretos por empresa
CREATE TABLE public.company_secrets (
    company_id UUID NOT NULL DEFAULT public.fn_current_company() REFERENCES public.companies(id) ON DELETE CASCADE,
    key VARCHAR(40) NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]*$'),
    ciphertext TEXT NOT NULL,
    hint VARCHAR(20),
    updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (company_id, key)
);
COMMENT ON TABLE public.company_secrets IS 'Credenciales de servicios externos por empresa, cifradas por la API (nunca se devuelven)';
COMMENT ON COLUMN public.company_secrets.key IS 'Qué secreto es (bccr_token)';
COMMENT ON COLUMN public.company_secrets.ciphertext IS 'AES-256-GCM: iv.tag.datos en base64url';
COMMENT ON COLUMN public.company_secrets.hint IS 'Últimos caracteres, para reconocerlo en pantalla';

DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['exchange_rate_runs', 'company_secrets'] LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('CREATE POLICY p_company_isolation ON public.%I
                          USING (company_id = (SELECT public.fn_current_company()))
                          WITH CHECK (company_id = (SELECT public.fn_current_company()))', t);
    END LOOP;
END
$$;
-- Sin auditoría de valores en company_secrets (aunque vaya cifrado); la bitácora sí se audita
CREATE TRIGGER trg_audit_exchange_rate_runs AFTER INSERT OR UPDATE OR DELETE ON public.exchange_rate_runs
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit();
REVOKE DELETE ON public.exchange_rate_runs FROM :"app_user";

-- --------------------------------------------------------------- Parámetros (por empresa)
INSERT INTO public.parameters (company_id, module_code, order_list, key, name, description, data_type, value, default_value, rules)
SELECT c.id, 'SETTINGS', s.ord, s.key, s.name, s.description, s.data_type, s.value::jsonb, s.value::jsonb, s.rules::jsonb
  FROM public.companies c
 CROSS JOIN (VALUES
    (20, 'rates_auto_enabled', 'Actualizar tasas de cambio automáticamente',
        'Consulta la tasa oficial del país (BCV en Venezuela, BCCR en Costa Rica) y la registra. Una tasa cargada a mano no se reemplaza.',
        'boolean', 'false', '{}'),
    (21, 'rates_interval_hours', 'Consultar la tasa cada (horas)',
        'Cada cuántas horas se consulta la fuente oficial mientras la actualización automática esté activa.',
        'integer', '4', '{"min":1,"max":24}'),
    (22, 'rates_bccr_side', 'Tasa del BCCR a usar',
        'Tipo de cambio de referencia del BCCR: venta (el usual en comprobantes) o compra.',
        'select', '"sell"', '{"countries":["CR"],"options":[{"value":"sell","label":"Venta"},{"value":"buy","label":"Compra"}]}')
 ) AS s(ord, key, name, description, data_type, value, rules)
ON CONFLICT DO NOTHING;

-- --------------------------------------------------------------- Alerta
ALTER TABLE public.alerts DROP CONSTRAINT alerts_kind_check;
ALTER TABLE public.alerts ADD CONSTRAINT alerts_kind_check CHECK (kind IN ('STOCK_MIN', 'STOCK_MAX', 'LOT_EXPIRING', 'LOT_EXPIRED',
    'QC_PENDING', 'PO_OVERDUE', 'PRO_LATE', 'SO_LATE', 'RATES_FAILED'));
