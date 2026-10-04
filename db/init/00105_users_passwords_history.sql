-- =====================================================================
--  FabriHub · 00105_users_passwords_history.sql
--  Hashes de contraseñas anteriores para impedir su reutilización.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.users_passwords_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    password_hash VARCHAR(100) NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.users_passwords_history IS 'Historial de hashes de contraseñas usadas, para impedir reutilizar las últimas N';
COMMENT ON COLUMN public.users_passwords_history.id IS 'Identificador único del registro';
COMMENT ON COLUMN public.users_passwords_history.user_id IS 'Usuario dueño';
COMMENT ON COLUMN public.users_passwords_history.password_hash IS 'Hash bcrypt de una contraseña usada previamente';
COMMENT ON COLUMN public.users_passwords_history.created_at IS 'Fecha en que la contraseña dejó de estar vigente';

CREATE INDEX IF NOT EXISTS idx_users_passwords_history_user
    ON public.users_passwords_history (user_id, created_at DESC);
