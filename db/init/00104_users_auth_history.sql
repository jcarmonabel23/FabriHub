-- =====================================================================
--  FabriHub · 00104_users_auth_history.sql
--  Bitácora de eventos de autenticación (inmutable para la app).
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.users_auth_history (
    id BIGSERIAL PRIMARY KEY,

    user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    email CITEXT,

    event_type VARCHAR(40) NOT NULL,
    success BOOLEAN NOT NULL,
    detail JSONB NOT NULL DEFAULT '{}',

    trace_id UUID,
    ip_address VARCHAR(64),
    user_agent TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.users_auth_history IS 'Historial de eventos de autenticación (login, OTP, refresh, logout, bloqueos, contraseñas)';
COMMENT ON COLUMN public.users_auth_history.id IS 'Identificador del evento';
COMMENT ON COLUMN public.users_auth_history.user_id IS 'Usuario (NULL si el correo no existe)';
COMMENT ON COLUMN public.users_auth_history.email IS 'Correo usado en el intento';
COMMENT ON COLUMN public.users_auth_history.event_type IS 'Tipo: sign_in, otp_verify, otp_resend, refresh, refresh_reuse, logout, logout_all, locked, password_change, password_forgot, password_reset, admin_reset';
COMMENT ON COLUMN public.users_auth_history.success IS 'Resultado del evento';
COMMENT ON COLUMN public.users_auth_history.detail IS 'Motivo o datos del evento (sin secretos)';
COMMENT ON COLUMN public.users_auth_history.trace_id IS 'Trace id de la petición (correlación con trace_api_logs)';
COMMENT ON COLUMN public.users_auth_history.ip_address IS 'IP del cliente';
COMMENT ON COLUMN public.users_auth_history.user_agent IS 'User-Agent del cliente';
COMMENT ON COLUMN public.users_auth_history.created_at IS 'Fecha y hora del evento';

CREATE INDEX IF NOT EXISTS idx_users_auth_history_user ON public.users_auth_history (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_auth_history_email ON public.users_auth_history (email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_auth_history_created ON public.users_auth_history (created_at DESC);
