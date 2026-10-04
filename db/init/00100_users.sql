-- =====================================================================
--  FabriHub · 00100_users.sql
--  Usuarios: identidad, credenciales y estado de bloqueo.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    email CITEXT NOT NULL UNIQUE,
    names VARCHAR(120) NOT NULL,
    password_hash VARCHAR(100) NOT NULL,

    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
    password_changed_at TIMESTAMPTZ,

    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ,

    logins INTEGER NOT NULL DEFAULT 0,
    last_login_at TIMESTAMPTZ,

    metadata JSONB NOT NULL DEFAULT '{}',

    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.users IS 'Usuarios de FabriHub: identidad, credenciales y estado de bloqueo';
COMMENT ON COLUMN public.users.id IS 'Identificador único del usuario';
COMMENT ON COLUMN public.users.email IS 'Correo electrónico; identificador de login (sin distinción de mayúsculas)';
COMMENT ON COLUMN public.users.names IS 'Nombre completo del usuario';
COMMENT ON COLUMN public.users.password_hash IS 'Hash bcrypt de la contraseña (nunca texto plano)';
COMMENT ON COLUMN public.users.is_active IS 'Cuenta activa. Una cuenta inactiva no puede iniciar sesión y sus sesiones se rechazan';
COMMENT ON COLUMN public.users.must_change_password IS 'Obliga a cambiar la contraseña antes de usar cualquier módulo (primer ingreso o reinicio por admin)';
COMMENT ON COLUMN public.users.password_changed_at IS 'Fecha del último cambio de contraseña';
COMMENT ON COLUMN public.users.failed_attempts IS 'Intentos fallidos de contraseña consecutivos';
COMMENT ON COLUMN public.users.locked_until IS 'Cuenta bloqueada por fuerza bruta hasta esta fecha (NULL = no bloqueada)';
COMMENT ON COLUMN public.users.logins IS 'Contador de inicios de sesión exitosos';
COMMENT ON COLUMN public.users.last_login_at IS 'Fecha del último inicio de sesión exitoso';
COMMENT ON COLUMN public.users.metadata IS 'Datos adicionales libres';
COMMENT ON COLUMN public.users.created_by IS 'Usuario que creó el registro';
COMMENT ON COLUMN public.users.updated_by IS 'Usuario que modificó el registro por última vez';
COMMENT ON COLUMN public.users.created_at IS 'Fecha y hora de creación del registro';
COMMENT ON COLUMN public.users.updated_at IS 'Fecha y hora de la última actualización del registro';

CREATE INDEX IF NOT EXISTS idx_users_active ON public.users (is_active);

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON public.users
    FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();
