-- =====================================================================
--  FabriHub · 00103_users_otp.sql
--  Códigos OTP de un solo uso (segundo factor de login y reinicio de
--  contraseña). Solo se guarda el hash; vencen y tienen intentos.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.users_otp (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    purpose VARCHAR(20) NOT NULL CHECK (purpose IN ('login', 'password_reset')),

    code_hash CHAR(64) NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    sends INTEGER NOT NULL DEFAULT 1,
    last_sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,

    ip_address VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.users_otp IS 'Desafíos OTP: segundo factor de login y verificación para reiniciar contraseña';
COMMENT ON COLUMN public.users_otp.id IS 'Identificador del desafío (challenge_id que recibe el front)';
COMMENT ON COLUMN public.users_otp.user_id IS 'Usuario al que pertenece el código';
COMMENT ON COLUMN public.users_otp.purpose IS 'Uso del código: login o password_reset';
COMMENT ON COLUMN public.users_otp.code_hash IS 'HMAC-SHA256 del código de 6 dígitos';
COMMENT ON COLUMN public.users_otp.attempts IS 'Intentos de validación fallidos';
COMMENT ON COLUMN public.users_otp.sends IS 'Veces que se envió un código para este desafío';
COMMENT ON COLUMN public.users_otp.last_sent_at IS 'Último envío (controla el tiempo de espera para reenviar)';
COMMENT ON COLUMN public.users_otp.expires_at IS 'Vencimiento del código';
COMMENT ON COLUMN public.users_otp.consumed_at IS 'Fecha de uso exitoso o de invalidación';
COMMENT ON COLUMN public.users_otp.ip_address IS 'IP que solicitó el código';
COMMENT ON COLUMN public.users_otp.created_at IS 'Fecha y hora de creación del desafío';

CREATE INDEX IF NOT EXISTS idx_users_otp_user ON public.users_otp (user_id, purpose) WHERE consumed_at IS NULL;
