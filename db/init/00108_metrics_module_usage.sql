-- =====================================================================
--  FabriHub · 00108_metrics_module_usage.sql
--  Visitas a módulos (alimenta el tablero de métricas de la fase 8).
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.metrics_module_usage (
    id BIGSERIAL PRIMARY KEY,

    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    module_code VARCHAR(40) NOT NULL,
    path VARCHAR(200),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.metrics_module_usage IS 'Registro de visitas de usuarios a módulos';
COMMENT ON COLUMN public.metrics_module_usage.id IS 'Identificador del registro';
COMMENT ON COLUMN public.metrics_module_usage.user_id IS 'Usuario que visitó el módulo';
COMMENT ON COLUMN public.metrics_module_usage.module_code IS 'Código del módulo visitado';
COMMENT ON COLUMN public.metrics_module_usage.path IS 'Ruta del front visitada';
COMMENT ON COLUMN public.metrics_module_usage.created_at IS 'Fecha y hora de la visita';

CREATE INDEX IF NOT EXISTS idx_metrics_module_usage_module ON public.metrics_module_usage (module_code, created_at DESC);
