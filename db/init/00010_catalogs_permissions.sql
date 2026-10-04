-- =====================================================================
--  FabriHub · 00010_catalogs_permissions.sql
--  Catálogo de permisos (acciones) concedibles sobre un módulo.
--  Mismo modelo que DaviHub: front y API consultan por SLUG.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.catalogs_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    order_list INTEGER NOT NULL DEFAULT 0,

    slug VARCHAR(40) NOT NULL UNIQUE,
    name VARCHAR(80) NOT NULL,
    description VARCHAR(400),

    metadata JSONB NOT NULL DEFAULT '{}',

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.catalogs_permissions IS 'Catálogo de permisos (acciones) concedibles sobre un módulo';
COMMENT ON COLUMN public.catalogs_permissions.id IS 'Identificador único del permiso';
COMMENT ON COLUMN public.catalogs_permissions.is_active IS 'Indica si el permiso está activo';
COMMENT ON COLUMN public.catalogs_permissions.order_list IS 'Orden de presentación';
COMMENT ON COLUMN public.catalogs_permissions.slug IS 'Clave de acción normalizada que consultan front y API (access, view, edit…)';
COMMENT ON COLUMN public.catalogs_permissions.name IS 'Nombre descriptivo del permiso';
COMMENT ON COLUMN public.catalogs_permissions.description IS 'Qué habilita el permiso dentro del módulo';
COMMENT ON COLUMN public.catalogs_permissions.metadata IS 'Datos adicionales libres';
COMMENT ON COLUMN public.catalogs_permissions.created_at IS 'Fecha y hora de creación del registro';
COMMENT ON COLUMN public.catalogs_permissions.updated_at IS 'Fecha y hora de la última actualización del registro';

CREATE TRIGGER trg_catalogs_permissions_updated_at
    BEFORE UPDATE ON public.catalogs_permissions
    FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

INSERT INTO public.catalogs_permissions (order_list, slug, name, description) VALUES
    ( 1, 'access',    'Acceso',     'Deja entrar al módulo: lo muestra en el menú y habilita su URL. Sin él, los demás permisos no sirven.'),
    ( 2, 'view',      'Ver',        'Consultar registros en solo lectura, acotados a lo propio (por ejemplo, a sus almacenes).'),
    ( 3, 'view_all',  'Ver todo',   'Amplía Ver a los registros de todos. Quien acota las filas es el servidor, no la pantalla.'),
    ( 4, 'add_new',   'Agregar',    'Crear registros nuevos.'),
    ( 5, 'edit',      'Editar',     'Modificar registros existentes.'),
    ( 6, 'delete',    'Eliminar',   'Dar de baja registros. Los documentos contabilizados no se eliminan: se reversan.'),
    ( 7, 'download',  'Descargar',  'Exportar el listado a Excel. No amplía el alcance de lo que se puede ver.'),
    ( 8, 'import',    'Importar',   'Carga masiva de registros desde archivo.'),
    ( 9, 'approve',   'Aprobar',    'Aprobar documentos (órdenes de compra, lotes de calidad). Nunca sobre lo creado por uno mismo.'),
    (10, 'release',   'Liberar',    'Liberar órdenes de producción a planta: reserva materiales y habilita su consumo.'),
    (11, 'close',     'Cerrar',     'Cerrar documentos (orden de producción): calcula el costo real y bloquea cambios.'),
    (12, 'configure', 'Configurar', 'Configuración sensible: asignar módulos a usuarios, poner módulos fuera de servicio, umbrales.')
ON CONFLICT (slug) DO NOTHING;
