-- =====================================================================
--  FabriHub · 20261004_0302_warehouses_products_lots.sql   (fase 3)
--  Tesis 4.2.2.1.1: Clases Almacén, Productos y Lotes.
--  + users_warehouses: alcance de datos (un almacenista ve y mueve solo sus almacenes).
-- =====================================================================

-- --------------------------------------------------------------- Almacenes
CREATE TABLE public.warehouses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    order_list INTEGER NOT NULL DEFAULT 0,
    code VARCHAR(20) NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9_-]+$'),
    name VARCHAR(80) NOT NULL,
    description VARCHAR(400),
    address VARCHAR(400),
    kind VARCHAR(12) NOT NULL DEFAULT 'storage' CHECK (kind IN ('storage', 'production', 'transit')),
    metadata JSONB NOT NULL DEFAULT '{}',
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE public.warehouses IS 'Almacenes: espacio físico donde se guardan los productos (tesis: Clase Almacén)';
COMMENT ON COLUMN public.warehouses.id IS 'Identificador único';
COMMENT ON COLUMN public.warehouses.is_active IS 'Indica si el almacén está activo';
COMMENT ON COLUMN public.warehouses.order_list IS 'Orden de presentación';
COMMENT ON COLUMN public.warehouses.code IS 'Código del almacén';
COMMENT ON COLUMN public.warehouses.name IS 'Nombre del almacén (tesis: Descripción)';
COMMENT ON COLUMN public.warehouses.description IS 'Descripción adicional';
COMMENT ON COLUMN public.warehouses.address IS 'Ubicación o dirección del almacén';
COMMENT ON COLUMN public.warehouses.kind IS 'Uso: storage (almacenamiento), production (planta, en proceso) o transit';
COMMENT ON COLUMN public.warehouses.metadata IS 'Datos adicionales libres';
COMMENT ON COLUMN public.warehouses.created_by IS 'Usuario que creó el registro';
COMMENT ON COLUMN public.warehouses.updated_by IS 'Usuario que modificó el registro por última vez';
COMMENT ON COLUMN public.warehouses.created_at IS 'Fecha y hora de creación';
COMMENT ON COLUMN public.warehouses.updated_at IS 'Fecha y hora de la última actualización';

CREATE TABLE public.users_warehouses (
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    warehouse_id UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, warehouse_id)
);
COMMENT ON TABLE public.users_warehouses IS 'Alcance de datos: almacenes que ve y mueve un usuario sin el permiso view_all';
COMMENT ON COLUMN public.users_warehouses.user_id IS 'Usuario';
COMMENT ON COLUMN public.users_warehouses.warehouse_id IS 'Almacén asignado';
COMMENT ON COLUMN public.users_warehouses.created_by IS 'Usuario que hizo la asignación';
COMMENT ON COLUMN public.users_warehouses.created_at IS 'Fecha de la asignación';

-- --------------------------------------------------------------- Productos
CREATE TABLE public.products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    code VARCHAR(30) NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9._-]+$'),
    name VARCHAR(160) NOT NULL,
    description VARCHAR(800),

    product_type_id UUID NOT NULL REFERENCES public.catalogs_product_types(id) ON DELETE RESTRICT,
    family_id UUID REFERENCES public.catalogs_product_families(id) ON DELETE RESTRICT,
    category_id UUID REFERENCES public.catalogs_product_categories(id) ON DELETE RESTRICT,
    tags TEXT[] NOT NULL DEFAULT '{}',

    stock_unit_id UUID NOT NULL REFERENCES public.catalogs_units(id) ON DELETE RESTRICT,
    purchase_unit_id UUID REFERENCES public.catalogs_units(id) ON DELETE RESTRICT,
    purchase_factor NUMERIC(18, 6) NOT NULL DEFAULT 1 CHECK (purchase_factor > 0),
    sale_unit_id UUID REFERENCES public.catalogs_units(id) ON DELETE RESTRICT,
    sale_factor NUMERIC(18, 6) NOT NULL DEFAULT 1 CHECK (sale_factor > 0),
    production_unit_id UUID REFERENCES public.catalogs_units(id) ON DELETE RESTRICT,
    production_factor NUMERIC(18, 6) NOT NULL DEFAULT 1 CHECK (production_factor > 0),

    is_stockable BOOLEAN NOT NULL DEFAULT TRUE,
    is_lot_controlled BOOLEAN NOT NULL DEFAULT FALSE,
    is_purchased BOOLEAN NOT NULL DEFAULT FALSE,
    is_sold BOOLEAN NOT NULL DEFAULT FALSE,
    is_manufactured BOOLEAN NOT NULL DEFAULT FALSE,
    is_on_hold BOOLEAN NOT NULL DEFAULT FALSE,
    shelf_life_days INTEGER CHECK (shelf_life_days > 0),

    fiscal_treatment_id UUID REFERENCES public.fiscal_treatments(id) ON DELETE RESTRICT,
    sale_price NUMERIC(18, 4) CHECK (sale_price >= 0),
    purchase_price NUMERIC(18, 4) CHECK (purchase_price >= 0),
    standard_cost NUMERIC(18, 6) CHECK (standard_cost >= 0),

    metadata JSONB NOT NULL DEFAULT '{}',
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT ck_products_lot_needs_stock CHECK (NOT is_lot_controlled OR is_stockable)
);
COMMENT ON TABLE public.products IS 'Maestro de productos (tesis: Clase Productos). La Cantidad Total NO se almacena: se calcula desde stock_valuation';
COMMENT ON COLUMN public.products.id IS 'Identificador único';
COMMENT ON COLUMN public.products.is_active IS 'Indica si el producto está activo';
COMMENT ON COLUMN public.products.code IS 'Código del producto';
COMMENT ON COLUMN public.products.name IS 'Nombre (descripción) del producto';
COMMENT ON COLUMN public.products.description IS 'Descripción ampliada';
COMMENT ON COLUMN public.products.product_type_id IS 'Tipo de producto';
COMMENT ON COLUMN public.products.family_id IS 'Familia (tesis: Código de Familia)';
COMMENT ON COLUMN public.products.category_id IS 'Categoría';
COMMENT ON COLUMN public.products.tags IS 'Agrupaciones libres (tesis: Concepto 1 al 6, normalizado a etiquetas)';
COMMENT ON COLUMN public.products.stock_unit_id IS 'Unidad de almacén: todas las cantidades de inventario se expresan en ella';
COMMENT ON COLUMN public.products.purchase_unit_id IS 'Unidad de compra';
COMMENT ON COLUMN public.products.purchase_factor IS 'Unidades de almacén por 1 unidad de compra';
COMMENT ON COLUMN public.products.sale_unit_id IS 'Unidad de venta';
COMMENT ON COLUMN public.products.sale_factor IS 'Unidades de almacén por 1 unidad de venta';
COMMENT ON COLUMN public.products.production_unit_id IS 'Unidad de producción';
COMMENT ON COLUMN public.products.production_factor IS 'Unidades de almacén por 1 unidad de producción';
COMMENT ON COLUMN public.products.is_stockable IS 'Inventariable (tangible); los servicios no lo son';
COMMENT ON COLUMN public.products.is_lot_controlled IS 'Manejado por lote: todo movimiento exige lote';
COMMENT ON COLUMN public.products.is_purchased IS 'Se compra a proveedores';
COMMENT ON COLUMN public.products.is_sold IS 'Se vende a clientes';
COMMENT ON COLUMN public.products.is_manufactured IS 'Se fabrica en planta (tiene fórmula y ruta)';
COMMENT ON COLUMN public.products.is_on_hold IS 'Retenido: bloquea todos sus movimientos de inventario';
COMMENT ON COLUMN public.products.shelf_life_days IS 'Vida útil en días; sugiere el vencimiento de los lotes nuevos';
COMMENT ON COLUMN public.products.fiscal_treatment_id IS 'Tratamiento fiscal (tesis: Código de Tratamiento Fiscal)';
COMMENT ON COLUMN public.products.sale_price IS 'Precio de venta de referencia (moneda base)';
COMMENT ON COLUMN public.products.purchase_price IS 'Precio de compra de referencia (moneda base)';
COMMENT ON COLUMN public.products.standard_cost IS 'Costo estándar (si el parámetro de costeo es "estándar")';
COMMENT ON COLUMN public.products.metadata IS 'Datos adicionales libres';
COMMENT ON COLUMN public.products.created_by IS 'Usuario que creó el registro';
COMMENT ON COLUMN public.products.updated_by IS 'Usuario que modificó el registro por última vez';
COMMENT ON COLUMN public.products.created_at IS 'Fecha y hora de creación';
COMMENT ON COLUMN public.products.updated_at IS 'Fecha y hora de la última actualización';

CREATE INDEX idx_products_type ON public.products (product_type_id);
CREATE INDEX idx_products_family ON public.products (family_id);
CREATE INDEX idx_products_name ON public.products (lower(name));

CREATE TABLE public.products_relations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    related_product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    kind VARCHAR(14) NOT NULL CHECK (kind IN ('substitute', 'complementary', 'equivalent')),
    valid_from DATE,
    notes VARCHAR(400),
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_products_relations UNIQUE (product_id, related_product_id, kind),
    CONSTRAINT ck_products_relations_self CHECK (product_id <> related_product_id)
);
COMMENT ON TABLE public.products_relations IS 'Producto Sustituto, Complementario y Equivalente de la tesis, normalizados a filas';
COMMENT ON COLUMN public.products_relations.id IS 'Identificador único';
COMMENT ON COLUMN public.products_relations.product_id IS 'Producto original';
COMMENT ON COLUMN public.products_relations.related_product_id IS 'Producto relacionado';
COMMENT ON COLUMN public.products_relations.kind IS 'substitute (lo reemplaza), complementary (lo acompaña en la venta) o equivalent (similar ante inexistencia)';
COMMENT ON COLUMN public.products_relations.valid_from IS 'Desde cuándo aplica (tesis: Fecha de Sustitución)';
COMMENT ON COLUMN public.products_relations.notes IS 'Observaciones';
COMMENT ON COLUMN public.products_relations.created_by IS 'Usuario que creó la relación';
COMMENT ON COLUMN public.products_relations.created_at IS 'Fecha de creación';

-- --------------------------------------------------------------- Lotes
CREATE SEQUENCE public.lots_internal_seq;

CREATE TABLE public.lots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    internal_number BIGINT NOT NULL UNIQUE DEFAULT nextval('public.lots_internal_seq'),

    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
    lot_code VARCHAR(40) NOT NULL CHECK (lot_code ~ '^[A-Za-z0-9._/-]+$'),
    description VARCHAR(400),

    manufactured_on DATE,
    expires_on DATE,
    received_on DATE,
    best_before DATE,

    quality_status VARCHAR(12) NOT NULL DEFAULT 'quarantine'
        CHECK (quality_status IN ('quarantine', 'approved', 'rejected', 'on_hold')),
    supplier_lot VARCHAR(40),
    unit_cost NUMERIC(18, 6),
    origin_movement_id UUID,

    metadata JSONB NOT NULL DEFAULT '{}',
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_lots_product_code UNIQUE (product_id, lot_code),
    CONSTRAINT ck_lots_dates CHECK (expires_on IS NULL OR manufactured_on IS NULL OR expires_on >= manufactured_on)
);
ALTER SEQUENCE public.lots_internal_seq OWNED BY public.lots.internal_number;

COMMENT ON TABLE public.lots IS 'Lotes (tesis: Clase Lotes): trazabilidad, vencimiento y estado de calidad';
COMMENT ON COLUMN public.lots.id IS 'Identificador único';
COMMENT ON COLUMN public.lots.internal_number IS 'Lote Interno: consecutivo de control interno';
COMMENT ON COLUMN public.lots.product_id IS 'Producto del lote';
COMMENT ON COLUMN public.lots.lot_code IS 'Código de lote (único por producto)';
COMMENT ON COLUMN public.lots.description IS 'Información adicional del lote';
COMMENT ON COLUMN public.lots.manufactured_on IS 'Fecha de fabricación';
COMMENT ON COLUMN public.lots.expires_on IS 'Fecha de vencimiento';
COMMENT ON COLUMN public.lots.received_on IS 'Fecha de recepción en el almacén';
COMMENT ON COLUMN public.lots.best_before IS 'Fecha máxima esperada de venta (tesis: Fecha Antes de)';
COMMENT ON COLUMN public.lots.quality_status IS 'Estado de calidad (tesis: CCalidad): quarantine, approved, rejected u on_hold (retenido)';
COMMENT ON COLUMN public.lots.supplier_lot IS 'Lote con que lo identifica el proveedor';
COMMENT ON COLUMN public.lots.unit_cost IS 'Costo unitario de entrada del lote';
COMMENT ON COLUMN public.lots.origin_movement_id IS 'Movimiento de inventario que creó el lote';
COMMENT ON COLUMN public.lots.metadata IS 'Datos adicionales (proveedor, orden de compra/venta: fases 4 y 6)';
COMMENT ON COLUMN public.lots.created_by IS 'Usuario que creó el registro';
COMMENT ON COLUMN public.lots.updated_by IS 'Usuario que modificó el registro por última vez';
COMMENT ON COLUMN public.lots.created_at IS 'Fecha y hora de creación';
COMMENT ON COLUMN public.lots.updated_at IS 'Fecha y hora de la última actualización';

CREATE INDEX idx_lots_product ON public.lots (product_id);
CREATE INDEX idx_lots_expires ON public.lots (expires_on);

-- --------------------------------------------------------------- Triggers
DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['warehouses', 'products', 'lots'] LOOP
        EXECUTE format('CREATE TRIGGER trg_%1$s_updated_at BEFORE UPDATE ON public.%1$I
                        FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at()', t);
    END LOOP;
    FOREACH t IN ARRAY ARRAY['warehouses', 'users_warehouses', 'products', 'products_relations', 'lots'] LOOP
        EXECUTE format('CREATE TRIGGER trg_audit_%1$s AFTER INSERT OR UPDATE OR DELETE ON public.%1$I
                        FOR EACH ROW EXECUTE FUNCTION public.fn_audit()', t);
    END LOOP;
END
$$;

-- fn_audit usa la columna id como registro; users_warehouses no la tiene → se audita igual (record_id NULL).
GRANT USAGE, SELECT ON SEQUENCE public.lots_internal_seq TO :"app_user";
