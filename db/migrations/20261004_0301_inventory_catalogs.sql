-- =====================================================================
--  FabriHub · 20261004_0301_inventory_catalogs.sql   (fase 3 · Inventario)
--  Catálogos de la tesis 4.2.2.1.1: Tipo de Productos, Familia de Productos,
--  Categoría de Producto, Tipo de Movimientos y Conceptos de Movimientos,
--  más Unidades (Unidad de Compra/Venta/Producción/Almacén de Productos).
-- =====================================================================

-- --------------------------------------------------------------- Unidades
CREATE TABLE public.catalogs_units (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    order_list INTEGER NOT NULL DEFAULT 0,
    code VARCHAR(20) NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9_-]+$'),
    name VARCHAR(80) NOT NULL,
    description VARCHAR(400),
    decimals SMALLINT NOT NULL DEFAULT 2 CHECK (decimals BETWEEN 0 AND 6),
    metadata JSONB NOT NULL DEFAULT '{}',
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE public.catalogs_units IS 'Unidades de medida (compra, venta, producción y almacén de los productos)';
COMMENT ON COLUMN public.catalogs_units.id IS 'Identificador único';
COMMENT ON COLUMN public.catalogs_units.is_active IS 'Indica si está activa';
COMMENT ON COLUMN public.catalogs_units.order_list IS 'Orden de presentación';
COMMENT ON COLUMN public.catalogs_units.code IS 'Código de la unidad (KG, UND, CAJA…)';
COMMENT ON COLUMN public.catalogs_units.name IS 'Nombre de la unidad';
COMMENT ON COLUMN public.catalogs_units.description IS 'Descripción opcional';
COMMENT ON COLUMN public.catalogs_units.decimals IS 'Decimales con que se registran cantidades en esta unidad';
COMMENT ON COLUMN public.catalogs_units.metadata IS 'Datos adicionales libres';
COMMENT ON COLUMN public.catalogs_units.created_by IS 'Usuario que creó el registro';
COMMENT ON COLUMN public.catalogs_units.updated_by IS 'Usuario que modificó el registro por última vez';
COMMENT ON COLUMN public.catalogs_units.created_at IS 'Fecha y hora de creación';
COMMENT ON COLUMN public.catalogs_units.updated_at IS 'Fecha y hora de la última actualización';

-- --------------------------------------------------------------- Tipos de producto
CREATE TABLE public.catalogs_product_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    order_list INTEGER NOT NULL DEFAULT 0,
    code VARCHAR(20) NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9_-]+$'),
    name VARCHAR(80) NOT NULL,
    description VARCHAR(400),
    nature VARCHAR(20) NOT NULL CHECK (nature IN ('raw_material', 'packaging', 'semi_finished', 'finished', 'spare_part', 'service')),
    metadata JSONB NOT NULL DEFAULT '{}',
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE public.catalogs_product_types IS 'Tipos de producto (tesis: Clase Tipo de Productos): condición o tratamiento del producto';
COMMENT ON COLUMN public.catalogs_product_types.id IS 'Identificador único';
COMMENT ON COLUMN public.catalogs_product_types.is_active IS 'Indica si está activo';
COMMENT ON COLUMN public.catalogs_product_types.order_list IS 'Orden de presentación';
COMMENT ON COLUMN public.catalogs_product_types.code IS 'Código de tipo (tesis: Código de Tipo)';
COMMENT ON COLUMN public.catalogs_product_types.name IS 'Nombre del tipo';
COMMENT ON COLUMN public.catalogs_product_types.description IS 'Descripción';
COMMENT ON COLUMN public.catalogs_product_types.nature IS 'Naturaleza: raw_material, packaging, semi_finished, finished, spare_part o service (no inventariable)';
COMMENT ON COLUMN public.catalogs_product_types.metadata IS 'Datos adicionales libres';
COMMENT ON COLUMN public.catalogs_product_types.created_by IS 'Usuario que creó el registro';
COMMENT ON COLUMN public.catalogs_product_types.updated_by IS 'Usuario que modificó el registro por última vez';
COMMENT ON COLUMN public.catalogs_product_types.created_at IS 'Fecha y hora de creación';
COMMENT ON COLUMN public.catalogs_product_types.updated_at IS 'Fecha y hora de la última actualización';

-- --------------------------------------------------------------- Familias
CREATE TABLE public.catalogs_product_families (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    order_list INTEGER NOT NULL DEFAULT 0,
    code VARCHAR(20) NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9_-]+$'),
    name VARCHAR(80) NOT NULL,
    description VARCHAR(400),
    metadata JSONB NOT NULL DEFAULT '{}',
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE public.catalogs_product_families IS 'Familias de productos (tesis: Clase Familia de Productos)';
COMMENT ON COLUMN public.catalogs_product_families.id IS 'Identificador único';
COMMENT ON COLUMN public.catalogs_product_families.is_active IS 'Indica si está activa';
COMMENT ON COLUMN public.catalogs_product_families.order_list IS 'Orden de presentación';
COMMENT ON COLUMN public.catalogs_product_families.code IS 'Código de familia';
COMMENT ON COLUMN public.catalogs_product_families.name IS 'Nombre de la familia';
COMMENT ON COLUMN public.catalogs_product_families.description IS 'Descripción';
COMMENT ON COLUMN public.catalogs_product_families.metadata IS 'Datos adicionales libres';
COMMENT ON COLUMN public.catalogs_product_families.created_by IS 'Usuario que creó el registro';
COMMENT ON COLUMN public.catalogs_product_families.updated_by IS 'Usuario que modificó el registro por última vez';
COMMENT ON COLUMN public.catalogs_product_families.created_at IS 'Fecha y hora de creación';
COMMENT ON COLUMN public.catalogs_product_families.updated_at IS 'Fecha y hora de la última actualización';

-- --------------------------------------------------------------- Categorías
CREATE TABLE public.catalogs_product_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    order_list INTEGER NOT NULL DEFAULT 0,
    code VARCHAR(20) NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9_-]+$'),
    name VARCHAR(80) NOT NULL,
    description VARCHAR(400),
    metadata JSONB NOT NULL DEFAULT '{}',
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE public.catalogs_product_categories IS 'Categorías de productos (tesis: Clase Categoría de Producto)';
COMMENT ON COLUMN public.catalogs_product_categories.id IS 'Identificador único';
COMMENT ON COLUMN public.catalogs_product_categories.is_active IS 'Indica si está activa';
COMMENT ON COLUMN public.catalogs_product_categories.order_list IS 'Orden de presentación';
COMMENT ON COLUMN public.catalogs_product_categories.code IS 'Código de categoría';
COMMENT ON COLUMN public.catalogs_product_categories.name IS 'Nombre de la categoría';
COMMENT ON COLUMN public.catalogs_product_categories.description IS 'Descripción';
COMMENT ON COLUMN public.catalogs_product_categories.metadata IS 'Datos adicionales libres';
COMMENT ON COLUMN public.catalogs_product_categories.created_by IS 'Usuario que creó el registro';
COMMENT ON COLUMN public.catalogs_product_categories.updated_by IS 'Usuario que modificó el registro por última vez';
COMMENT ON COLUMN public.catalogs_product_categories.created_at IS 'Fecha y hora de creación';
COMMENT ON COLUMN public.catalogs_product_categories.updated_at IS 'Fecha y hora de la última actualización';

-- --------------------------------------------------------------- Tipos de movimiento
-- Definidos por el sistema: su `direction` gobierna la lógica de contabilización.
CREATE TABLE public.catalogs_movement_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    order_list INTEGER NOT NULL DEFAULT 0,
    code VARCHAR(20) NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9_-]+$'),
    name VARCHAR(80) NOT NULL,
    description VARCHAR(400),
    direction VARCHAR(10) NOT NULL CHECK (direction IN ('in', 'out', 'transfer')),
    validates_exit BOOLEAN NOT NULL DEFAULT TRUE,
    debit_account VARCHAR(30),
    credit_account VARCHAR(30),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE public.catalogs_movement_types IS 'Tipos de movimiento de inventario (tesis: Clase Tipo de Movimientos de Inventario)';
COMMENT ON COLUMN public.catalogs_movement_types.id IS 'Identificador único';
COMMENT ON COLUMN public.catalogs_movement_types.is_active IS 'Indica si está activo';
COMMENT ON COLUMN public.catalogs_movement_types.order_list IS 'Orden de presentación';
COMMENT ON COLUMN public.catalogs_movement_types.code IS 'Código del tipo de movimiento';
COMMENT ON COLUMN public.catalogs_movement_types.name IS 'Nombre del tipo';
COMMENT ON COLUMN public.catalogs_movement_types.description IS 'Descripción';
COMMENT ON COLUMN public.catalogs_movement_types.direction IS 'Efecto: in (entrada), out (salida) o transfer (traslado entre almacenes)';
COMMENT ON COLUMN public.catalogs_movement_types.validates_exit IS 'Verifica la existencia antes de sacar (tesis: ValidaSalida)';
COMMENT ON COLUMN public.catalogs_movement_types.debit_account IS 'Cuenta contable de débito (tesis: Cuenta Débito)';
COMMENT ON COLUMN public.catalogs_movement_types.credit_account IS 'Cuenta contable de crédito (tesis: Cuenta Crédito)';
COMMENT ON COLUMN public.catalogs_movement_types.created_at IS 'Fecha y hora de creación';
COMMENT ON COLUMN public.catalogs_movement_types.updated_at IS 'Fecha y hora de la última actualización';

-- --------------------------------------------------------------- Conceptos de movimiento
-- Corrección a la tesis (4.2.2.2.1): un TIPO tiene muchos CONCEPTOS, no al revés.
CREATE TABLE public.catalogs_movement_concepts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    is_system BOOLEAN NOT NULL DEFAULT FALSE,
    order_list INTEGER NOT NULL DEFAULT 0,
    code VARCHAR(20) NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9_-]+$'),
    name VARCHAR(80) NOT NULL,
    description VARCHAR(400),
    movement_type_id UUID NOT NULL REFERENCES public.catalogs_movement_types(id) ON DELETE RESTRICT,
    module_code VARCHAR(40) NOT NULL REFERENCES public.catalogs_modules(code) ON UPDATE CASCADE,
    lot_status_on_entry VARCHAR(12) NOT NULL DEFAULT 'approved' CHECK (lot_status_on_entry IN ('approved', 'quarantine')),
    allows_unapproved_lots BOOLEAN NOT NULL DEFAULT FALSE,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE public.catalogs_movement_concepts IS 'Motivos de entrada/salida (tesis: Clase Conceptos de Movimientos de Inventarios)';
COMMENT ON COLUMN public.catalogs_movement_concepts.id IS 'Identificador único';
COMMENT ON COLUMN public.catalogs_movement_concepts.is_active IS 'Indica si está activo';
COMMENT ON COLUMN public.catalogs_movement_concepts.is_system IS 'Lo usa el código de otro módulo: no se elimina ni cambia de tipo/módulo';
COMMENT ON COLUMN public.catalogs_movement_concepts.order_list IS 'Orden de presentación';
COMMENT ON COLUMN public.catalogs_movement_concepts.code IS 'Código del concepto';
COMMENT ON COLUMN public.catalogs_movement_concepts.name IS 'Nombre del concepto';
COMMENT ON COLUMN public.catalogs_movement_concepts.description IS 'Descripción';
COMMENT ON COLUMN public.catalogs_movement_concepts.movement_type_id IS 'Tipo de movimiento (entrada, salida, traslado)';
COMMENT ON COLUMN public.catalogs_movement_concepts.module_code IS 'Módulo que puede usar el concepto (tesis: Módulo); INVENTORY = movimientos manuales';
COMMENT ON COLUMN public.catalogs_movement_concepts.lot_status_on_entry IS 'Estado de calidad de los lotes NUEVOS que entran con este concepto';
COMMENT ON COLUMN public.catalogs_movement_concepts.allows_unapproved_lots IS 'Permite sacar lotes no aprobados o vencidos (p. ej. destrucción de rechazados)';
COMMENT ON COLUMN public.catalogs_movement_concepts.metadata IS 'Datos adicionales libres';
COMMENT ON COLUMN public.catalogs_movement_concepts.created_by IS 'Usuario que creó el registro';
COMMENT ON COLUMN public.catalogs_movement_concepts.updated_by IS 'Usuario que modificó el registro por última vez';
COMMENT ON COLUMN public.catalogs_movement_concepts.created_at IS 'Fecha y hora de creación';
COMMENT ON COLUMN public.catalogs_movement_concepts.updated_at IS 'Fecha y hora de la última actualización';

-- --------------------------------------------------------------- Triggers comunes
DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['catalogs_units', 'catalogs_product_types', 'catalogs_product_families',
                             'catalogs_product_categories', 'catalogs_movement_types', 'catalogs_movement_concepts'] LOOP
        EXECUTE format('CREATE TRIGGER trg_%1$s_updated_at BEFORE UPDATE ON public.%1$I
                        FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at()', t);
        EXECUTE format('CREATE TRIGGER trg_audit_%1$s AFTER INSERT OR UPDATE OR DELETE ON public.%1$I
                        FOR EACH ROW EXECUTE FUNCTION public.fn_audit()', t);
    END LOOP;
END
$$;

-- Los tipos de movimiento los define el código: la app solo los lee.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.catalogs_movement_types FROM :"app_user";

-- --------------------------------------------------------------- Semillas
INSERT INTO public.catalogs_units (order_list, code, name, decimals) VALUES
    (1, 'UND', 'Unidad', 0),
    (2, 'KG', 'Kilogramo', 3),
    (3, 'G', 'Gramo', 2),
    (4, 'L', 'Litro', 3),
    (5, 'ML', 'Mililitro', 2),
    (6, 'CAJA', 'Caja', 0),
    (7, 'BLISTER', 'Blíster', 0),
    (8, 'FRASCO', 'Frasco', 0),
    (9, 'MILLAR', 'Millar', 0),
    (10, 'H', 'Hora', 2);

INSERT INTO public.catalogs_product_types (order_list, code, name, nature) VALUES
    (1, 'MP', 'Materia prima', 'raw_material'),
    (2, 'ME', 'Material de empaque', 'packaging'),
    (3, 'SE', 'Semielaborado', 'semi_finished'),
    (4, 'PT', 'Producto terminado', 'finished'),
    (5, 'RE', 'Repuesto', 'spare_part'),
    (6, 'SV', 'Servicio', 'service');

INSERT INTO public.catalogs_product_families (order_list, code, name) VALUES
    (1, 'ANALG', 'Analgésicos'),
    (2, 'ANTIB', 'Antibióticos'),
    (3, 'ANTIH', 'Antihipertensivos'),
    (4, 'ANTIG', 'Antigripales'),
    (5, 'GASTRO', 'Gastrointestinales'),
    (6, 'VITAM', 'Vitamínicos'),
    (7, 'INSUMO', 'Insumos de producción');

INSERT INTO public.catalogs_product_categories (order_list, code, name) VALUES
    (1, 'SOLIDOS', 'Sólidos orales'),
    (2, 'LIQUIDOS', 'Líquidos orales'),
    (3, 'SEMISOL', 'Semisólidos'),
    (4, 'INYECT', 'Inyectables'),
    (5, 'INSUMOS', 'Insumos');

INSERT INTO public.catalogs_movement_types (order_list, code, name, direction, validates_exit, debit_account, credit_account) VALUES
    (1, 'ENT', 'Entrada', 'in', FALSE, '1.1.07.01', '2.1.01.01'),
    (2, 'SAL', 'Salida', 'out', TRUE, '5.1.01.01', '1.1.07.01'),
    (3, 'TRF', 'Traslado', 'transfer', TRUE, '1.1.07.01', '1.1.07.01');

INSERT INTO public.catalogs_movement_concepts
    (order_list, is_system, code, name, description, movement_type_id, module_code, lot_status_on_entry, allows_unapproved_lots)
SELECT s.ord, s.sys, s.code, s.name, s.description, t.id, s.module_code, s.lot_status, s.allows_unapproved
FROM (VALUES
    -- Manuales (módulo Inventario)
    ( 1, TRUE,  'INV_INI',   'Inventario inicial',          'Carga de existencias al arrancar el sistema',         'ENT', 'INVENTORY',  'approved',   FALSE),
    ( 2, TRUE,  'AJ_POS',    'Ajuste positivo',             'Sobrante detectado en conteo físico',                 'ENT', 'INVENTORY',  'approved',   FALSE),
    ( 3, TRUE,  'AJ_NEG',    'Ajuste negativo',             'Faltante detectado en conteo físico',                 'SAL', 'INVENTORY',  'approved',   TRUE),
    ( 4, FALSE, 'CONSUMO',   'Consumo interno',             'Uso interno (laboratorio, muestras)',                 'SAL', 'INVENTORY',  'approved',   FALSE),
    ( 5, TRUE,  'MERMA',     'Merma / destrucción',         'Vencidos, rechazados o dañados',                      'SAL', 'INVENTORY',  'approved',   TRUE),
    ( 6, TRUE,  'TRASLADO',  'Traslado entre almacenes',    'Mueve existencia y costo de un almacén a otro',       'TRF', 'INVENTORY',  'approved',   FALSE),
    -- De otros módulos (fases 4 a 6): los generan sus documentos
    (10, TRUE,  'REC_COMPRA','Recepción de compra',         'Entrada por recepción de orden de compra',            'ENT', 'PURCHASES',  'quarantine', FALSE),
    (11, TRUE,  'DEV_PROV',  'Devolución a proveedor',      'Salida por devolución de mercancía',                  'SAL', 'PURCHASES',  'approved',   TRUE),
    (12, TRUE,  'DESP_VENTA','Despacho de venta',           'Salida por nota de entrega',                          'SAL', 'SALES',      'approved',   FALSE),
    (13, TRUE,  'DEV_CLIENTE','Devolución de cliente',      'Entrada por devolución; queda en cuarentena',         'ENT', 'SALES',      'quarantine', FALSE),
    (14, TRUE,  'CONS_PROD', 'Consumo de producción',       'Salida de materiales hacia una orden de producción',  'SAL', 'PRODUCTION', 'approved',   FALSE),
    (15, TRUE,  'ENT_PROD',  'Entrada de producción',       'Entrada de producto fabricado',                       'ENT', 'PRODUCTION', 'quarantine', FALSE)
) AS s(ord, sys, code, name, description, type_code, module_code, lot_status, allows_unapproved)
JOIN public.catalogs_movement_types t ON t.code = s.type_code;
