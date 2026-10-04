-- =====================================================================
--  FabriHub · 00101_users_modules.sql
--  Tabla puente RBAC (modelo DaviHub): qué módulos tiene un usuario,
--  con qué roles y qué permisos extra.
--  Permisos efectivos = unión de los permisos de role_ids + permissions.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.users_modules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    module_id UUID NOT NULL REFERENCES public.catalogs_modules(id) ON DELETE CASCADE,

    role_ids JSONB NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(role_ids) = 'array'),
    permissions JSONB NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(permissions) = 'array'),

    metadata JSONB NOT NULL DEFAULT '{}',

    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_users_modules_user_module UNIQUE (user_id, module_id)
);

COMMENT ON TABLE public.users_modules IS 'Asignación de módulos (hojas) a un usuario con sus roles: puente RBAC entre users y catalogs_modules';
COMMENT ON COLUMN public.users_modules.id IS 'Identificador único de la asignación';
COMMENT ON COLUMN public.users_modules.is_active IS 'Indica si la asignación está activa';
COMMENT ON COLUMN public.users_modules.user_id IS 'Usuario al que se asigna el módulo';
COMMENT ON COLUMN public.users_modules.module_id IS 'Módulo (pantalla) asignado';
COMMENT ON COLUMN public.users_modules.role_ids IS 'Roles del usuario en el módulo: arreglo JSON de ids de catalogs_roles';
COMMENT ON COLUMN public.users_modules.permissions IS 'Permisos extra (slugs) además de los que conceden los roles';
COMMENT ON COLUMN public.users_modules.metadata IS 'Datos adicionales libres';
COMMENT ON COLUMN public.users_modules.created_by IS 'Usuario que hizo la asignación';
COMMENT ON COLUMN public.users_modules.updated_by IS 'Usuario que modificó la asignación por última vez';
COMMENT ON COLUMN public.users_modules.created_at IS 'Fecha y hora de creación del registro';
COMMENT ON COLUMN public.users_modules.updated_at IS 'Fecha y hora de la última actualización del registro';

CREATE INDEX IF NOT EXISTS idx_users_modules_user ON public.users_modules (user_id);
CREATE INDEX IF NOT EXISTS idx_users_modules_module ON public.users_modules (module_id);
CREATE INDEX IF NOT EXISTS idx_users_modules_role_ids ON public.users_modules USING GIN (role_ids);

CREATE TRIGGER trg_users_modules_updated_at
    BEFORE UPDATE ON public.users_modules
    FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

-- ---------------------------------------------------------------------
-- Permisos efectivos por usuario y módulo. Única fuente que consultan el
-- login (para el front) y el middleware requirePermission (para la API).
-- Un rol inactivo no concede nada; un módulo raíz no se asigna.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_users_effective_permissions AS
SELECT
    um.user_id,
    m.id   AS module_id,
    m.code AS module_code,
    COALESCE(
        (SELECT jsonb_agg(DISTINCT p ORDER BY p)
           FROM (
                SELECT jsonb_array_elements_text(r.permissions) AS p
                  FROM public.catalogs_roles r
                 WHERE r.is_active
                   AND r.id::text IN (SELECT jsonb_array_elements_text(um.role_ids))
                UNION
                SELECT jsonb_array_elements_text(um.permissions)
           ) perms
          WHERE p IN (SELECT slug FROM public.catalogs_permissions WHERE is_active)),
        '[]'::jsonb
    ) AS permissions
FROM public.users_modules um
JOIN public.catalogs_modules m ON m.id = um.module_id AND m.is_active
WHERE um.is_active;

COMMENT ON VIEW public.v_users_effective_permissions IS 'Permisos efectivos (unión de roles activos + extras) por usuario y módulo';
