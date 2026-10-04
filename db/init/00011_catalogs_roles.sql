-- =====================================================================
--  FabriHub · 00011_catalogs_roles.sql
--  Catálogo de roles. Un rol es un conjunto de slugs de permisos y se
--  asigna POR MÓDULO en users_modules.role_ids (modelo DaviHub).
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.catalogs_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    is_system BOOLEAN NOT NULL DEFAULT FALSE,
    order_list INTEGER NOT NULL DEFAULT 0,

    slug VARCHAR(40) NOT NULL UNIQUE,
    name VARCHAR(80) NOT NULL,
    description VARCHAR(400),

    permissions JSONB NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(permissions) = 'array'),

    metadata JSONB NOT NULL DEFAULT '{}',

    created_by UUID,
    updated_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.catalogs_roles IS 'Catálogo de roles; cada rol concede un conjunto de permisos (slugs de catalogs_permissions)';
COMMENT ON COLUMN public.catalogs_roles.id IS 'Identificador único del rol';
COMMENT ON COLUMN public.catalogs_roles.is_active IS 'Indica si el rol está activo (un rol inactivo no concede permisos)';
COMMENT ON COLUMN public.catalogs_roles.is_system IS 'Rol semilla: no se puede eliminar ni cambiar su slug';
COMMENT ON COLUMN public.catalogs_roles.order_list IS 'Orden de presentación';
COMMENT ON COLUMN public.catalogs_roles.slug IS 'Clave normalizada del rol';
COMMENT ON COLUMN public.catalogs_roles.name IS 'Nombre descriptivo del rol';
COMMENT ON COLUMN public.catalogs_roles.description IS 'Para qué perfil de usuario está pensado el rol';
COMMENT ON COLUMN public.catalogs_roles.permissions IS 'Arreglo JSON de slugs de catalogs_permissions que concede el rol';
COMMENT ON COLUMN public.catalogs_roles.metadata IS 'Datos adicionales libres';
COMMENT ON COLUMN public.catalogs_roles.created_by IS 'Usuario que creó el registro';
COMMENT ON COLUMN public.catalogs_roles.updated_by IS 'Usuario que modificó el registro por última vez';
COMMENT ON COLUMN public.catalogs_roles.created_at IS 'Fecha y hora de creación del registro';
COMMENT ON COLUMN public.catalogs_roles.updated_at IS 'Fecha y hora de la última actualización del registro';

CREATE INDEX IF NOT EXISTS idx_catalogs_roles_permissions ON public.catalogs_roles USING GIN (permissions);

CREATE TRIGGER trg_catalogs_roles_updated_at
    BEFORE UPDATE ON public.catalogs_roles
    FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

INSERT INTO public.catalogs_roles (order_list, is_system, slug, name, description, permissions) VALUES
    (1, TRUE, 'admin',           'Administrador',            'Control total del módulo asignado.',
        '["access","view","view_all","add_new","edit","delete","download","import","approve","release","close","configure"]'),
    (2, TRUE, 'planner',         'Planificador',             'Planes de venta y producción, MRP y creación de órdenes.',
        '["access","view","view_all","add_new","edit","download"]'),
    (3, TRUE, 'prod_supervisor', 'Supervisor de producción', 'Libera, ejecuta y cierra órdenes de producción.',
        '["access","view","view_all","add_new","edit","release","close","download"]'),
    (4, TRUE, 'warehouse',       'Almacenista',              'Movimientos de inventario de SUS almacenes.',
        '["access","view","add_new","edit"]'),
    (5, TRUE, 'quality',         'Control de calidad',       'Aprueba o rechaza lotes en cuarentena.',
        '["access","view","view_all","approve","download"]'),
    (6, TRUE, 'buyer',           'Comprador',                'Proveedores, órdenes de compra y recepciones.',
        '["access","view","view_all","add_new","edit","download"]'),
    (7, TRUE, 'seller',          'Vendedor',                 'Clientes, órdenes de venta y notas de entrega.',
        '["access","view","add_new","edit","download"]'),
    (8, TRUE, 'viewer',          'Consulta',                 'Solo lectura de todo el módulo.',
        '["access","view","view_all"]')
ON CONFLICT (slug) DO NOTHING;
