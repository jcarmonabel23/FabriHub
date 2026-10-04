-- =====================================================================
--  FabriHub · 00106_trace_api_logs.sql
--  Traza de peticiones a la API: todas las escrituras y todos los errores.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.trace_api_logs (
    id BIGSERIAL PRIMARY KEY,

    trace_id UUID NOT NULL,
    user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,

    method VARCHAR(10) NOT NULL,
    path VARCHAR(300) NOT NULL,
    status INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL,
    error_code VARCHAR(60),

    ip_address VARCHAR(64),
    user_agent TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.trace_api_logs IS 'Traza de peticiones a la API (escrituras y errores), correlacionable por trace_id';
COMMENT ON COLUMN public.trace_api_logs.id IS 'Identificador del registro';
COMMENT ON COLUMN public.trace_api_logs.trace_id IS 'Trace id de la petición (cabecera x-trace-id)';
COMMENT ON COLUMN public.trace_api_logs.user_id IS 'Usuario autenticado, si lo hubo';
COMMENT ON COLUMN public.trace_api_logs.method IS 'Método HTTP';
COMMENT ON COLUMN public.trace_api_logs.path IS 'Ruta invocada (sin query string)';
COMMENT ON COLUMN public.trace_api_logs.status IS 'Código HTTP de respuesta';
COMMENT ON COLUMN public.trace_api_logs.duration_ms IS 'Duración en milisegundos';
COMMENT ON COLUMN public.trace_api_logs.error_code IS 'Código de error de negocio, si lo hubo';
COMMENT ON COLUMN public.trace_api_logs.ip_address IS 'IP del cliente';
COMMENT ON COLUMN public.trace_api_logs.user_agent IS 'User-Agent del cliente';
COMMENT ON COLUMN public.trace_api_logs.created_at IS 'Fecha y hora de la petición';

CREATE INDEX IF NOT EXISTS idx_trace_api_logs_trace ON public.trace_api_logs (trace_id);
CREATE INDEX IF NOT EXISTS idx_trace_api_logs_created ON public.trace_api_logs (created_at DESC);
