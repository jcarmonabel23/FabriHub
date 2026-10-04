-- =====================================================================
--  FabriHub · 00012_catalogs_modules.sql
--  Catálogo de módulos (subsistemas de la tesis, cap. 4.2.2.1).
--  · Raíz  = subsistema (hub con tarjetas). No se asigna a usuarios.
--  · Hoja  = pantalla. Es lo que se asigna en users_modules.
--  Los módulos de fases futuras nacen con is_offline = TRUE: se ven en el
--  tablero como "Próximamente" y la API los rechaza.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.catalogs_modules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    order_list INTEGER NOT NULL DEFAULT 0,

    code VARCHAR(40) NOT NULL UNIQUE CHECK (code ~ '^[A-Z][A-Z0-9_]*$'),
    name VARCHAR(80) NOT NULL,
    description VARCHAR(400),
    icon VARCHAR(40),
    path VARCHAR(120) NOT NULL UNIQUE,

    module_parent_id UUID REFERENCES public.catalogs_modules(id) ON DELETE RESTRICT,
    is_public BOOLEAN NOT NULL DEFAULT FALSE,

    is_offline BOOLEAN NOT NULL DEFAULT FALSE,
    is_show_dev BOOLEAN NOT NULL DEFAULT TRUE,
    is_show_qa BOOLEAN NOT NULL DEFAULT TRUE,
    is_show_prod BOOLEAN NOT NULL DEFAULT TRUE,

    metadata JSONB NOT NULL DEFAULT '{}',

    created_by UUID,
    updated_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.catalogs_modules IS 'Catálogo de módulos funcionales de FabriHub (raíces = subsistemas, hojas = pantallas asignables)';
COMMENT ON COLUMN public.catalogs_modules.id IS 'Identificador único del módulo';
COMMENT ON COLUMN public.catalogs_modules.is_active IS 'Indica si el módulo está activo';
COMMENT ON COLUMN public.catalogs_modules.order_list IS 'Orden de presentación en tablero y menú';
COMMENT ON COLUMN public.catalogs_modules.code IS 'Código único UPPER_SNAKE que usan front (useCan) y API (requirePermission)';
COMMENT ON COLUMN public.catalogs_modules.name IS 'Nombre visible del módulo';
COMMENT ON COLUMN public.catalogs_modules.description IS 'Descripción corta mostrada en la tarjeta del tablero';
COMMENT ON COLUMN public.catalogs_modules.icon IS 'Clave del ícono (Tabler) que pinta el front';
COMMENT ON COLUMN public.catalogs_modules.path IS 'Ruta del front que abre el módulo';
COMMENT ON COLUMN public.catalogs_modules.module_parent_id IS 'Módulo padre (NULL = raíz/subsistema)';
COMMENT ON COLUMN public.catalogs_modules.is_public IS 'Accesible para cualquier usuario autenticado sin asignación (p. ej. Tablero)';
COMMENT ON COLUMN public.catalogs_modules.is_offline IS 'Fuera de servicio: el front muestra mantenimiento y la API responde 503';
COMMENT ON COLUMN public.catalogs_modules.is_show_dev IS 'Visible en el entorno de desarrollo';
COMMENT ON COLUMN public.catalogs_modules.is_show_qa IS 'Visible en el entorno de QA';
COMMENT ON COLUMN public.catalogs_modules.is_show_prod IS 'Visible en el entorno de producción';
COMMENT ON COLUMN public.catalogs_modules.metadata IS 'Datos adicionales libres (p. ej. fase del plan)';
COMMENT ON COLUMN public.catalogs_modules.created_by IS 'Usuario que creó el registro';
COMMENT ON COLUMN public.catalogs_modules.updated_by IS 'Usuario que modificó el registro por última vez';
COMMENT ON COLUMN public.catalogs_modules.created_at IS 'Fecha y hora de creación del registro';
COMMENT ON COLUMN public.catalogs_modules.updated_at IS 'Fecha y hora de la última actualización del registro';

CREATE INDEX IF NOT EXISTS idx_catalogs_modules_parent ON public.catalogs_modules (module_parent_id);

CREATE TRIGGER trg_catalogs_modules_updated_at
    BEFORE UPDATE ON public.catalogs_modules
    FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

-- ------------------------------------------------------------ Raíces (subsistemas)
INSERT INTO public.catalogs_modules (order_list, code, name, description, icon, path, is_public, is_offline, metadata) VALUES
    (1, 'DASHBOARD',  'Tablero',                    'Indicadores, alertas y accesos rápidos.',                          'layout-dashboard', '/dashboard',  TRUE,  FALSE, '{"phase":0}'),
    (2, 'INVENTORY',  'Inventario',                 'Productos, almacenes, lotes, movimientos y existencias.',          'packages',         '/inventory',  FALSE, TRUE,  '{"phase":3}'),
    (3, 'PRODUCTION', 'Planificación y Producción', 'Rutas, fórmulas, centros, planificación (MRP) y órdenes.',         'building-factory-2','/production', FALSE, TRUE,  '{"phase":5}'),
    (4, 'PURCHASES',  'Compras',                    'Proveedores, órdenes de compra y recepciones.',                     'shopping-cart',    '/purchases',  FALSE, TRUE,  '{"phase":4}'),
    (5, 'SALES',      'Ventas',                     'Clientes, órdenes de venta y notas de entrega.',                    'receipt',          '/sales',      FALSE, TRUE,  '{"phase":6}'),
    (6, 'QUALITY',    'Calidad',                    'Cuarentena y liberación de lotes.',                                 'microscope',       '/quality',    FALSE, TRUE,  '{"phase":4}'),
    (7, 'TAXES',      'Impuestos',                  'Impuestos, retenciones y tratamientos fiscales.',                   'receipt-tax',      '/taxes',      FALSE, FALSE,  '{"phase":2}'),
    (8, 'SETTINGS',   'Parámetros',                 'Datos de la empresa, parámetros y catálogos comerciales.',          'adjustments',      '/settings',   FALSE, FALSE,  '{"phase":2}'),
    (9, 'ADMIN',      'Seguridad',                  'Usuarios, roles, módulos y auditoría.',                             'shield-lock',      '/admin',      FALSE, FALSE, '{"phase":1}')
ON CONFLICT (code) DO NOTHING;

-- ------------------------------------------------------------ Hojas (pantallas)
INSERT INTO public.catalogs_modules (order_list, code, name, description, icon, path, is_offline, metadata, module_parent_id)
SELECT h.order_list, h.code, h.name, h.description, h.icon, h.path, h.is_offline, h.metadata::jsonb, p.id
FROM (VALUES
    -- Inventario
    (1, 'INV_PRODUCTS',      'Productos',              'Maestro de productos y explosión/implosión.',   'package',           '/inventory/products',      TRUE, '{"phase":3}', 'INVENTORY'),
    (2, 'INV_CATALOGS',      'Catálogos de inventario','Tipos, familias, categorías y unidades.',        'category',          '/inventory/catalogs',      TRUE, '{"phase":3}', 'INVENTORY'),
    (3, 'INV_WAREHOUSES',    'Almacenes',              'Almacenes y políticas de stock.',                'building-warehouse','/inventory/warehouses',    TRUE, '{"phase":3}', 'INVENTORY'),
    (4, 'INV_LOTS',          'Lotes',                  'Lotes, vencimientos y estado de calidad.',       'barcode',           '/inventory/lots',          TRUE, '{"phase":3}', 'INVENTORY'),
    (5, 'INV_MOVEMENTS',     'Movimientos',            'Entradas, salidas y transferencias.',            'arrows-exchange',   '/inventory/movements',     TRUE, '{"phase":3}', 'INVENTORY'),
    (6, 'INV_STOCK',         'Existencias',            'Existencias por almacén/lote y kárdex.',         'stack-2',           '/inventory/stock',         TRUE, '{"phase":3}', 'INVENTORY'),
    -- Planificación y Producción
    (1, 'PRD_STAGES',        'Etapas',                 'Fases del proceso productivo.',                  'list-numbers',      '/production/stages',       TRUE, '{"phase":5}', 'PRODUCTION'),
    (2, 'PRD_ROUTES',        'Rutas',                  'Rutas y tiempos teóricos por etapa.',            'route',             '/production/routes',       TRUE, '{"phase":5}', 'PRODUCTION'),
    (3, 'PRD_FORMULAS',      'Fórmulas (BOM)',         'Lista de materiales por producto y ruta.',       'flask',             '/production/formulas',     TRUE, '{"phase":5}', 'PRODUCTION'),
    (4, 'PRD_CENTERS',       'Centros',                'Centros de producción y de trabajo.',            'tool',              '/production/centers',      TRUE, '{"phase":5}', 'PRODUCTION'),
    (5, 'PRD_PLANNING',      'Planificación (MRP)',    'Plan de ventas, plan maestro y necesidades.',    'calendar-stats',    '/production/planning',     TRUE, '{"phase":7}', 'PRODUCTION'),
    (6, 'PRD_ORDERS',        'Órdenes de producción',  'Ciclo completo de la orden de producción.',      'clipboard-list',    '/production/orders',       TRUE, '{"phase":5}', 'PRODUCTION'),
    (7, 'PRD_TRACKING',      'Seguimiento',            'Avance por etapa y tiempos reales.',             'timeline',          '/production/tracking',     TRUE, '{"phase":5}', 'PRODUCTION'),
    -- Compras
    (1, 'PUR_SUPPLIERS',     'Proveedores',            'Proveedores y contactos.',                       'truck',             '/purchases/suppliers',     TRUE, '{"phase":4}', 'PURCHASES'),
    (2, 'PUR_BUYERS',        'Compradores',            'Personal de compras.',                           'user-dollar',       '/purchases/buyers',        TRUE, '{"phase":4}', 'PURCHASES'),
    (3, 'PUR_PRICE_LISTS',   'Listas de precios',      'Precios de compra por proveedor.',               'currency-dollar',   '/purchases/price-lists',   TRUE, '{"phase":4}', 'PURCHASES'),
    (4, 'PUR_ORDERS',        'Órdenes de compra',      'Emisión, aprobación y seguimiento.',             'file-invoice',      '/purchases/orders',        TRUE, '{"phase":4}', 'PURCHASES'),
    (5, 'PUR_RECEPTIONS',    'Recepciones',            'Recepción de mercancía y lotes.',                'truck-delivery',    '/purchases/receptions',    TRUE, '{"phase":4}', 'PURCHASES'),
    -- Ventas
    (1, 'SAL_CUSTOMERS',     'Clientes',               'Clientes y contactos.',                          'users-group',       '/sales/customers',         TRUE, '{"phase":6}', 'SALES'),
    (2, 'SAL_SELLERS',       'Vendedores',             'Fuerza de ventas.',                              'user-star',         '/sales/sellers',           TRUE, '{"phase":6}', 'SALES'),
    (3, 'SAL_PRICE_LISTS',   'Listas de precios',      'Precios de venta por cliente.',                  'tags',              '/sales/price-lists',       TRUE, '{"phase":6}', 'SALES'),
    (4, 'SAL_ORDERS',        'Órdenes de venta',       'Pedidos de clientes.',                           'file-dollar',       '/sales/orders',            TRUE, '{"phase":6}', 'SALES'),
    (5, 'SAL_DELIVERY_NOTES','Notas de entrega',       'Despacho con selección FEFO de lotes.',          'package-export',    '/sales/delivery-notes',    TRUE, '{"phase":6}', 'SALES'),
    -- Calidad
    (1, 'QC_LOTS',           'Liberación de lotes',    'Aprobar o rechazar lotes en cuarentena.',        'rosette-discount-check','/quality/lots',        TRUE, '{"phase":4}', 'QUALITY'),
    -- Impuestos
    (1, 'TAX_TAXES',         'Impuestos',              'Impuestos y tarifas (IVA).',                     'percentage',        '/taxes/taxes',             FALSE, '{"phase":2}', 'TAXES'),
    (2, 'TAX_WITHHOLDINGS',  'Retenciones',            'Retenciones y tramos (IVA, ISLR).',              'scale',             '/taxes/withholdings',      FALSE, '{"phase":2}', 'TAXES'),
    (3, 'TAX_TREATMENTS',    'Tratamientos fiscales',  'Combinación de impuesto y retención.',           'file-certificate',  '/taxes/treatments',        FALSE, '{"phase":2}', 'TAXES'),
    -- Parámetros
    (1, 'SET_COMPANY',       'Empresa',                'Datos de la compañía.',                          'building',          '/settings/company',        FALSE, '{"phase":2}', 'SETTINGS'),
    (2, 'SET_PARAMETERS',    'Parámetros',             'Parámetros por módulo.',                         'settings',          '/settings/parameters',     FALSE, '{"phase":2}', 'SETTINGS'),
    (3, 'SET_COMMERCIAL',    'Catálogos comerciales',  'Condiciones de pago/entrega, zonas, monedas.',    'list-details',      '/settings/commercial',     FALSE, '{"phase":2}', 'SETTINGS'),
    -- Seguridad
    (1, 'ADM_USERS',         'Usuarios',               'Altas, estado, módulos y sesiones.',             'users',             '/admin/users',             FALSE,'{"phase":1}', 'ADMIN'),
    (2, 'ADM_ROLES',         'Roles',                  'Roles y sus permisos.',                          'id-badge-2',        '/admin/roles',             FALSE,'{"phase":1}', 'ADMIN'),
    (3, 'ADM_MODULES',       'Módulos',                'Estado y visibilidad de los módulos.',           'apps',              '/admin/modules',           FALSE,'{"phase":1}', 'ADMIN'),
    (4, 'ADM_AUDIT',         'Auditoría',              'Cambios en datos y accesos al sistema.',         'history',           '/admin/audit',             FALSE,'{"phase":1}', 'ADMIN')
) AS h(order_list, code, name, description, icon, path, is_offline, metadata, parent_code)
JOIN public.catalogs_modules p ON p.code = h.parent_code
ON CONFLICT (code) DO NOTHING;
