-- =====================================================================
--  FabriHub · 00102_users_sessions.sql
--  Sesiones con refresh token rotativo. Se guarda solo el hash SHA-256.
--  Si llega un refresh ya rotado (reuso = robo probable), se revocan
--  todas las sesiones del usuario.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.users_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

    refresh_hash CHAR(64) NOT NULL UNIQUE,
    prev_refresh_hash CHAR(64),
    rotations INTEGER NOT NULL DEFAULT 0,
    rotated_at TIMESTAMPTZ,

    ip_address VARCHAR(64),
    user_agent TEXT,

    expires_at TIMESTAMPTZ NOT NULL,
    last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ,
    revoke_reason VARCHAR(40),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.users_sessions IS 'Sesiones activas e históricas; el access JWT lleva el id (sid) y se valida contra esta tabla';
COMMENT ON COLUMN public.users_sessions.id IS 'Identificador de la sesión (claim sid del JWT)';
COMMENT ON COLUMN public.users_sessions.user_id IS 'Usuario dueño de la sesión';
COMMENT ON COLUMN public.users_sessions.refresh_hash IS 'SHA-256 del refresh token vigente';
COMMENT ON COLUMN public.users_sessions.prev_refresh_hash IS 'SHA-256 del refresh anterior, para detectar reuso tras la rotación';
COMMENT ON COLUMN public.users_sessions.rotations IS 'Cantidad de rotaciones del refresh token';
COMMENT ON COLUMN public.users_sessions.rotated_at IS 'Última rotación; un refresh viejo presentado segundos después es una carrera entre pestañas, no un robo';
COMMENT ON COLUMN public.users_sessions.ip_address IS 'IP desde la que se abrió la sesión';
COMMENT ON COLUMN public.users_sessions.user_agent IS 'User-Agent del navegador';
COMMENT ON COLUMN public.users_sessions.expires_at IS 'Vencimiento absoluto: la rotación no lo extiende';
COMMENT ON COLUMN public.users_sessions.last_used_at IS 'Última actividad; si supera el tiempo de inactividad la sesión caduca';
COMMENT ON COLUMN public.users_sessions.revoked_at IS 'Fecha de revocación (logout, admin, reuso detectado)';
COMMENT ON COLUMN public.users_sessions.revoke_reason IS 'Motivo de revocación: logout, logout_all, admin, reuse, password_change, deactivated';
COMMENT ON COLUMN public.users_sessions.created_at IS 'Fecha y hora de inicio de la sesión';

CREATE INDEX IF NOT EXISTS idx_users_sessions_user ON public.users_sessions (user_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_users_sessions_prev ON public.users_sessions (prev_refresh_hash);
