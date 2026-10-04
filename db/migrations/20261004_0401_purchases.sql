-- =====================================================================
--  FabriHub · 20261004_0401_purchases.sql   (fase 4 · Compras)
--  Tesis 4.2.2.1.3: Orden de Compras, Detalles Orden de Compras, Proveedores,
--  Contacto Proveedores, Lista de Precios Proveedor, Recepción y Comprador.
--
--  Normalización respecto a la tesis:
--    · Lista de precios = cabecera (price_lists) + renglones (price_lists_items), compartida con
--      Ventas (scope 'purchases' | 'sales'); el proveedor/cliente apunta a una lista.
--    · Teléfono 1-3 / Fax 1-3 → arreglo JSON de teléfonos (el fax se omite: en desuso).
--    · Tipo y Estado de la Orden → máquina de estados explícita (status) con CHECK.
--    · Montos de la orden (subtotal, impuestos, retenciones, total) se calculan con el motor
--      fiscal de la API y se guardan como foto del documento.
-- =====================================================================

-- --------------------------------------------------------------- Listas de precios
CREATE TABLE public.price_lists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    code VARCHAR(20) NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9_-]+$'),
    name VARCHAR(120) NOT NULL,
    scope VARCHAR(10) NOT NULL CHECK (scope IN ('purchases', 'sales')),
    currency_id UUID NOT NULL REFERENCES public.catalogs_currencies(id) ON DELETE RESTRICT,
    valid_from DATE,
    valid_to DATE,
    notes VARCHAR(400),
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_price_lists_validity CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
);
COMMENT ON TABLE public.price_lists IS 'Listas de precios de compra (proveedores) o venta (clientes) — tesis: Clase Lista de Precios';
COMMENT ON COLUMN public.price_lists.id IS 'Identificador único';
COMMENT ON COLUMN public.price_lists.is_active IS 'Indica si la lista está activa';
COMMENT ON COLUMN public.price_lists.code IS 'Código de la lista de precios';
COMMENT ON COLUMN public.price_lists.name IS 'Nombre o descripción de la lista';
COMMENT ON COLUMN public.price_lists.scope IS 'Módulo de la tesis: purchases (proveedores) o sales (clientes)';
COMMENT ON COLUMN public.price_lists.currency_id IS 'Moneda en que se expresan los precios';
COMMENT ON COLUMN public.price_lists.valid_from IS 'Inicio de vigencia de la lista';
COMMENT ON COLUMN public.price_lists.valid_to IS 'Fin de vigencia de la lista';
COMMENT ON COLUMN public.price_lists.notes IS 'Observaciones';
COMMENT ON COLUMN public.price_lists.created_by IS 'Usuario que creó la lista';
COMMENT ON COLUMN public.price_lists.updated_by IS 'Usuario que la modificó por última vez';
COMMENT ON COLUMN public.price_lists.created_at IS 'Fecha y hora de creación';
COMMENT ON COLUMN public.price_lists.updated_at IS 'Fecha y hora de la última actualización';

CREATE TABLE public.price_lists_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    price_list_id UUID NOT NULL REFERENCES public.price_lists(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    unit_id UUID REFERENCES public.catalogs_units(id) ON DELETE RESTRICT,
    price NUMERIC(18, 4) NOT NULL CHECK (price >= 0),
    promo_price NUMERIC(18, 4) CHECK (promo_price >= 0),
    promo_from DATE,
    promo_to DATE,
    updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_price_lists_items UNIQUE (price_list_id, product_id),
    CONSTRAINT ck_price_lists_items_promo CHECK (promo_price IS NULL OR (promo_from IS NOT NULL AND promo_to IS NOT NULL AND promo_to >= promo_from))
);
COMMENT ON TABLE public.price_lists_items IS 'Precios por producto de una lista (tesis: Precio de Compra/Venta, Precio Promoción, Fecha Inicio/Fin)';
COMMENT ON COLUMN public.price_lists_items.id IS 'Identificador único';
COMMENT ON COLUMN public.price_lists_items.price_list_id IS 'Lista a la que pertenece';
COMMENT ON COLUMN public.price_lists_items.product_id IS 'Producto';
COMMENT ON COLUMN public.price_lists_items.unit_id IS 'Unidad del precio (NULL = unidad de compra/venta del producto)';
COMMENT ON COLUMN public.price_lists_items.price IS 'Precio unitario';
COMMENT ON COLUMN public.price_lists_items.promo_price IS 'Precio de promoción';
COMMENT ON COLUMN public.price_lists_items.promo_from IS 'Inicio de la promoción';
COMMENT ON COLUMN public.price_lists_items.promo_to IS 'Fin de la promoción';
COMMENT ON COLUMN public.price_lists_items.updated_by IS 'Usuario que fijó el precio';
COMMENT ON COLUMN public.price_lists_items.updated_at IS 'Último cambio';

-- --------------------------------------------------------------- Compradores
CREATE TABLE public.buyers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    order_list INTEGER NOT NULL DEFAULT 0,
    code VARCHAR(20) NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9_-]+$'),
    name VARCHAR(120) NOT NULL,
    description VARCHAR(400),
    phone VARCHAR(30),
    email VARCHAR(200),
    metadata JSONB NOT NULL DEFAULT '{}',
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE public.buyers IS 'Compradores: personas que generan órdenes de compra (tesis: Clase Comprador)';
COMMENT ON COLUMN public.buyers.id IS 'Identificador único';
COMMENT ON COLUMN public.buyers.is_active IS 'Indica si está activo';
COMMENT ON COLUMN public.buyers.order_list IS 'Orden de presentación';
COMMENT ON COLUMN public.buyers.code IS 'Código de Comprador';
COMMENT ON COLUMN public.buyers.name IS 'Nombre del comprador';
COMMENT ON COLUMN public.buyers.description IS 'Observaciones';
COMMENT ON COLUMN public.buyers.phone IS 'Teléfono';
COMMENT ON COLUMN public.buyers.email IS 'Correo electrónico';
COMMENT ON COLUMN public.buyers.metadata IS 'Datos adicionales libres';
COMMENT ON COLUMN public.buyers.created_by IS 'Usuario que creó el registro';
COMMENT ON COLUMN public.buyers.updated_by IS 'Usuario que modificó el registro por última vez';
COMMENT ON COLUMN public.buyers.created_at IS 'Fecha y hora de creación';
COMMENT ON COLUMN public.buyers.updated_at IS 'Fecha y hora de la última actualización';

-- --------------------------------------------------------------- Proveedores
CREATE TABLE public.suppliers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    code VARCHAR(20) NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9_-]+$'),
    legal_name VARCHAR(160) NOT NULL,
    trade_name VARCHAR(120),
    rif VARCHAR(12) NOT NULL UNIQUE CHECK (rif ~ '^[VEJPG]-[0-9]{8}-[0-9]$'),
    phones JSONB NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(phones) = 'array'),
    email VARCHAR(200),
    address VARCHAR(400),
    city VARCHAR(80),
    state VARCHAR(80),
    country VARCHAR(80) NOT NULL DEFAULT 'Venezuela',
    notes VARCHAR(800),

    payment_term_id UUID REFERENCES public.catalogs_payment_terms(id) ON DELETE RESTRICT,
    delivery_term_id UUID REFERENCES public.catalogs_delivery_terms(id) ON DELETE RESTRICT,
    delivery_method_id UUID REFERENCES public.catalogs_delivery_methods(id) ON DELETE RESTRICT,
    zone_id UUID REFERENCES public.catalogs_zones(id) ON DELETE RESTRICT,
    business_type_id UUID REFERENCES public.catalogs_business_types(id) ON DELETE RESTRICT,
    buyer_id UUID REFERENCES public.buyers(id) ON DELETE RESTRICT,
    price_list_id UUID REFERENCES public.price_lists(id) ON DELETE RESTRICT,
    fiscal_treatment_id UUID REFERENCES public.fiscal_treatments(id) ON DELETE RESTRICT,
    currency_id UUID REFERENCES public.catalogs_currencies(id) ON DELETE RESTRICT,
    payable_account VARCHAR(30),
    expense_account VARCHAR(30),

    metadata JSONB NOT NULL DEFAULT '{}',
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE public.suppliers IS 'Proveedores de materia prima, empaque y servicios (tesis: Clase Proveedores)';
COMMENT ON COLUMN public.suppliers.id IS 'Identificador único';
COMMENT ON COLUMN public.suppliers.is_active IS 'Status: proveedor operativo';
COMMENT ON COLUMN public.suppliers.code IS 'Código de Proveedor';
COMMENT ON COLUMN public.suppliers.legal_name IS 'Nombre o razón social';
COMMENT ON COLUMN public.suppliers.trade_name IS 'Apodo o denominación comercial';
COMMENT ON COLUMN public.suppliers.rif IS 'Registro de Información Fiscal (único)';
COMMENT ON COLUMN public.suppliers.phones IS 'Teléfonos (tesis: Teléfono 1 al 3)';
COMMENT ON COLUMN public.suppliers.email IS 'Correo principal';
COMMENT ON COLUMN public.suppliers.address IS 'Dirección';
COMMENT ON COLUMN public.suppliers.city IS 'Ciudad';
COMMENT ON COLUMN public.suppliers.state IS 'Estado';
COMMENT ON COLUMN public.suppliers.country IS 'País';
COMMENT ON COLUMN public.suppliers.notes IS 'Observaciones';
COMMENT ON COLUMN public.suppliers.payment_term_id IS 'Condición de pago';
COMMENT ON COLUMN public.suppliers.delivery_term_id IS 'Condición de entrega';
COMMENT ON COLUMN public.suppliers.delivery_method_id IS 'Método de entrega';
COMMENT ON COLUMN public.suppliers.zone_id IS 'Zona';
COMMENT ON COLUMN public.suppliers.business_type_id IS 'Tipo de negocio (agrupación; la tesis repite Categoría con la misma función)';
COMMENT ON COLUMN public.suppliers.buyer_id IS 'Comprador asignado';
COMMENT ON COLUMN public.suppliers.price_list_id IS 'Lista de precios de compra';
COMMENT ON COLUMN public.suppliers.fiscal_treatment_id IS 'Tratamiento fiscal (impuestos y retenciones del proveedor)';
COMMENT ON COLUMN public.suppliers.currency_id IS 'Moneda habitual de sus órdenes';
COMMENT ON COLUMN public.suppliers.payable_account IS 'Cuenta contable por pagar';
COMMENT ON COLUMN public.suppliers.expense_account IS 'Cuenta contable de gastos';
COMMENT ON COLUMN public.suppliers.metadata IS 'Datos adicionales libres';
COMMENT ON COLUMN public.suppliers.created_by IS 'Usuario que creó el registro';
COMMENT ON COLUMN public.suppliers.updated_by IS 'Usuario que modificó el registro por última vez';
COMMENT ON COLUMN public.suppliers.created_at IS 'Fecha y hora de creación';
COMMENT ON COLUMN public.suppliers.updated_at IS 'Fecha y hora de la última actualización';

CREATE TABLE public.suppliers_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_id UUID NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
    name VARCHAR(120) NOT NULL,
    position VARCHAR(80),
    phone VARCHAR(30),
    email VARCHAR(200),
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE public.suppliers_contacts IS 'Personas contacto de un proveedor (tesis: Clase Contacto Proveedores)';
COMMENT ON COLUMN public.suppliers_contacts.id IS 'Código Contacto';
COMMENT ON COLUMN public.suppliers_contacts.supplier_id IS 'Proveedor';
COMMENT ON COLUMN public.suppliers_contacts.name IS 'Nombre';
COMMENT ON COLUMN public.suppliers_contacts.position IS 'Cargo';
COMMENT ON COLUMN public.suppliers_contacts.phone IS 'Teléfono';
COMMENT ON COLUMN public.suppliers_contacts.email IS 'Correo';
COMMENT ON COLUMN public.suppliers_contacts.is_primary IS 'Contacto principal';
COMMENT ON COLUMN public.suppliers_contacts.created_by IS 'Usuario que lo registró';
COMMENT ON COLUMN public.suppliers_contacts.created_at IS 'Fecha de registro';
CREATE INDEX idx_suppliers_contacts_supplier ON public.suppliers_contacts (supplier_id);

-- --------------------------------------------------------------- Órdenes de compra
CREATE TABLE public.purchase_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    number VARCHAR(30) NOT NULL UNIQUE,
    status VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'pending_approval', 'approved', 'partially_received', 'received', 'closed', 'cancelled')),

    supplier_id UUID NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
    contact_id UUID REFERENCES public.suppliers_contacts(id) ON DELETE SET NULL,
    buyer_id UUID REFERENCES public.buyers(id) ON DELETE RESTRICT,
    order_date DATE NOT NULL DEFAULT CURRENT_DATE,
    expected_date DATE,
    warehouse_id UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
    delivery_address VARCHAR(400),

    currency_id UUID NOT NULL REFERENCES public.catalogs_currencies(id) ON DELETE RESTRICT,
    exchange_rate NUMERIC(20, 8) NOT NULL DEFAULT 1 CHECK (exchange_rate > 0),
    payment_term_id UUID REFERENCES public.catalogs_payment_terms(id) ON DELETE RESTRICT,
    delivery_term_id UUID REFERENCES public.catalogs_delivery_terms(id) ON DELETE RESTRICT,
    delivery_method_id UUID REFERENCES public.catalogs_delivery_methods(id) ON DELETE RESTRICT,
    discount_pct NUMERIC(7, 4) NOT NULL DEFAULT 0 CHECK (discount_pct BETWEEN 0 AND 100),

    subtotal NUMERIC(20, 2) NOT NULL DEFAULT 0,
    discount_amount NUMERIC(20, 2) NOT NULL DEFAULT 0,
    taxable_amount NUMERIC(20, 2) NOT NULL DEFAULT 0,
    tax_amount NUMERIC(20, 2) NOT NULL DEFAULT 0,
    total NUMERIC(20, 2) NOT NULL DEFAULT 0,
    withholding_amount NUMERIC(20, 2) NOT NULL DEFAULT 0,
    payable NUMERIC(20, 2) NOT NULL DEFAULT 0,
    taxes_detail JSONB NOT NULL DEFAULT '[]',

    supplier_reference VARCHAR(60),
    notes VARCHAR(800),

    submitted_at TIMESTAMPTZ,
    approved_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    approved_at TIMESTAMPTZ,
    closed_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    closed_at TIMESTAMPTZ,
    cancel_reason VARCHAR(400),

    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE public.purchase_orders IS 'Cabecera de la orden de compra (tesis: Clase Orden de Compras)';
COMMENT ON COLUMN public.purchase_orders.id IS 'Identificador único';
COMMENT ON COLUMN public.purchase_orders.number IS 'Nº Orden de Compra (correlativo PO)';
COMMENT ON COLUMN public.purchase_orders.status IS 'Estado: draft, pending_approval, approved (pendiente por recibir), partially_received (BackOrder), received, closed, cancelled';
COMMENT ON COLUMN public.purchase_orders.supplier_id IS 'Proveedor';
COMMENT ON COLUMN public.purchase_orders.contact_id IS 'Persona contacto del proveedor';
COMMENT ON COLUMN public.purchase_orders.buyer_id IS 'Comprador';
COMMENT ON COLUMN public.purchase_orders.order_date IS 'Fecha de la orden (fija la tasa de cambio y la vigencia fiscal)';
COMMENT ON COLUMN public.purchase_orders.expected_date IS 'Fecha esperada de recepción';
COMMENT ON COLUMN public.purchase_orders.warehouse_id IS 'Almacén donde se recibirá';
COMMENT ON COLUMN public.purchase_orders.delivery_address IS 'Dirección de entrega';
COMMENT ON COLUMN public.purchase_orders.currency_id IS 'Moneda de la orden';
COMMENT ON COLUMN public.purchase_orders.exchange_rate IS 'Tasa de cambio a moneda base vigente en la fecha de la orden';
COMMENT ON COLUMN public.purchase_orders.payment_term_id IS 'Condición de pago';
COMMENT ON COLUMN public.purchase_orders.delivery_term_id IS 'Condición de entrega';
COMMENT ON COLUMN public.purchase_orders.delivery_method_id IS 'Método de entrega';
COMMENT ON COLUMN public.purchase_orders.discount_pct IS 'Descuento global de la orden (%)';
COMMENT ON COLUMN public.purchase_orders.subtotal IS 'Suma de líneas antes del descuento global';
COMMENT ON COLUMN public.purchase_orders.discount_amount IS 'Monto del descuento global';
COMMENT ON COLUMN public.purchase_orders.taxable_amount IS 'Base imponible (Monto Subtotal de la tesis)';
COMMENT ON COLUMN public.purchase_orders.tax_amount IS 'Impuestos';
COMMENT ON COLUMN public.purchase_orders.total IS 'Monto Total del documento';
COMMENT ON COLUMN public.purchase_orders.withholding_amount IS 'Retenciones a aplicar al pagar';
COMMENT ON COLUMN public.purchase_orders.payable IS 'Neto a pagar (total − retenciones)';
COMMENT ON COLUMN public.purchase_orders.taxes_detail IS 'Desglose de impuestos y retenciones (foto del cálculo)';
COMMENT ON COLUMN public.purchase_orders.supplier_reference IS 'Referencia del proveedor (cotización)';
COMMENT ON COLUMN public.purchase_orders.notes IS 'Observaciones';
COMMENT ON COLUMN public.purchase_orders.submitted_at IS 'Cuándo se envió a aprobación';
COMMENT ON COLUMN public.purchase_orders.approved_by IS 'Quién la aprobó (nunca quien la creó)';
COMMENT ON COLUMN public.purchase_orders.approved_at IS 'Cuándo se aprobó';
COMMENT ON COLUMN public.purchase_orders.closed_by IS 'Quién la cerró';
COMMENT ON COLUMN public.purchase_orders.closed_at IS 'Cuándo se cerró';
COMMENT ON COLUMN public.purchase_orders.cancel_reason IS 'Motivo de anulación';
COMMENT ON COLUMN public.purchase_orders.created_by IS 'Quién la creó';
COMMENT ON COLUMN public.purchase_orders.updated_by IS 'Quién la modificó por última vez';
COMMENT ON COLUMN public.purchase_orders.created_at IS 'Fecha y hora de creación';
COMMENT ON COLUMN public.purchase_orders.updated_at IS 'Fecha y hora de la última actualización';
CREATE INDEX idx_purchase_orders_supplier ON public.purchase_orders (supplier_id);
CREATE INDEX idx_purchase_orders_status ON public.purchase_orders (status);

CREATE TABLE public.purchase_orders_details (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_order_id UUID NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
    line_no INTEGER NOT NULL CHECK (line_no > 0),
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
    unit_id UUID NOT NULL REFERENCES public.catalogs_units(id) ON DELETE RESTRICT,
    unit_factor NUMERIC(18, 6) NOT NULL DEFAULT 1 CHECK (unit_factor > 0),
    quantity NUMERIC(18, 6) NOT NULL CHECK (quantity > 0),
    unit_price NUMERIC(18, 4) NOT NULL CHECK (unit_price >= 0),
    discount_pct NUMERIC(7, 4) NOT NULL DEFAULT 0 CHECK (discount_pct BETWEEN 0 AND 100),
    fiscal_treatment_id UUID REFERENCES public.fiscal_treatments(id) ON DELETE RESTRICT,
    tax_rate NUMERIC(7, 4) NOT NULL DEFAULT 0,
    net_amount NUMERIC(20, 2) NOT NULL DEFAULT 0,
    tax_amount NUMERIC(20, 2) NOT NULL DEFAULT 0,
    expected_date DATE,
    quantity_received NUMERIC(18, 6) NOT NULL DEFAULT 0 CHECK (quantity_received >= 0),
    notes VARCHAR(400),
    CONSTRAINT uq_purchase_orders_details_line UNIQUE (purchase_order_id, line_no)
);
COMMENT ON TABLE public.purchase_orders_details IS 'Líneas de la orden de compra (tesis: Clase Detalles Orden de Compras)';
COMMENT ON COLUMN public.purchase_orders_details.id IS 'Identificador único';
COMMENT ON COLUMN public.purchase_orders_details.purchase_order_id IS 'Orden de compra';
COMMENT ON COLUMN public.purchase_orders_details.line_no IS 'Nº Línea';
COMMENT ON COLUMN public.purchase_orders_details.product_id IS 'Producto';
COMMENT ON COLUMN public.purchase_orders_details.unit_id IS 'Unidad en que se pide (normalmente la de compra)';
COMMENT ON COLUMN public.purchase_orders_details.unit_factor IS 'Unidades de almacén por unidad pedida (foto del factor del producto)';
COMMENT ON COLUMN public.purchase_orders_details.quantity IS 'Cantidad Pedida (en la unidad de la línea)';
COMMENT ON COLUMN public.purchase_orders_details.unit_price IS 'Precio Unitario en la moneda de la orden';
COMMENT ON COLUMN public.purchase_orders_details.discount_pct IS 'Descuento de la línea (%)';
COMMENT ON COLUMN public.purchase_orders_details.fiscal_treatment_id IS 'Tratamiento fiscal aplicado a la línea';
COMMENT ON COLUMN public.purchase_orders_details.tax_rate IS 'Alícuota aplicada (%)';
COMMENT ON COLUMN public.purchase_orders_details.net_amount IS 'Neto de la línea (cantidad × precio − descuentos)';
COMMENT ON COLUMN public.purchase_orders_details.tax_amount IS 'Impuesto de la línea';
COMMENT ON COLUMN public.purchase_orders_details.expected_date IS 'Fecha esperada de recepción de la línea';
COMMENT ON COLUMN public.purchase_orders_details.quantity_received IS 'Cantidad Recibida (en la unidad de la línea)';
COMMENT ON COLUMN public.purchase_orders_details.notes IS 'Observaciones';

-- --------------------------------------------------------------- Recepciones
CREATE TABLE public.receptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    number VARCHAR(30) NOT NULL UNIQUE,
    kind VARCHAR(10) NOT NULL DEFAULT 'receipt' CHECK (kind IN ('receipt', 'return')),
    status VARCHAR(10) NOT NULL DEFAULT 'posted' CHECK (status IN ('posted', 'cancelled')),
    purchase_order_id UUID NOT NULL REFERENCES public.purchase_orders(id) ON DELETE RESTRICT,
    returned_reception_id UUID REFERENCES public.receptions(id) ON DELETE RESTRICT,
    reception_date DATE NOT NULL DEFAULT CURRENT_DATE,
    warehouse_id UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
    delivery_note VARCHAR(60),
    exchange_rate NUMERIC(20, 8) NOT NULL DEFAULT 1,
    movement_id UUID REFERENCES public.inventory_movements(id) ON DELETE RESTRICT,
    notes VARCHAR(800),
    cancelled_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    cancelled_at TIMESTAMPTZ,
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE public.receptions IS 'Recepciones y devoluciones a proveedor (tesis: Clase Recepción, Nº de Mercancía Recibida)';
COMMENT ON COLUMN public.receptions.id IS 'Identificador único';
COMMENT ON COLUMN public.receptions.number IS 'Nº de Mercancía Recibida (correlativo REC)';
COMMENT ON COLUMN public.receptions.kind IS 'receipt (recepción) o return (devolución al proveedor)';
COMMENT ON COLUMN public.receptions.status IS 'posted o cancelled (anulada: su movimiento se reversó)';
COMMENT ON COLUMN public.receptions.purchase_order_id IS 'Orden de compra';
COMMENT ON COLUMN public.receptions.returned_reception_id IS 'En devoluciones: recepción de la que se devuelve';
COMMENT ON COLUMN public.receptions.reception_date IS 'Fecha de recepción';
COMMENT ON COLUMN public.receptions.warehouse_id IS 'Almacén donde entró (o del que sale la devolución)';
COMMENT ON COLUMN public.receptions.delivery_note IS 'Nº Nota de Entrega del proveedor';
COMMENT ON COLUMN public.receptions.exchange_rate IS 'Tasa usada para llevar el costo a moneda base';
COMMENT ON COLUMN public.receptions.movement_id IS 'Movimiento de inventario generado (Generar Transacción)';
COMMENT ON COLUMN public.receptions.notes IS 'Observaciones';
COMMENT ON COLUMN public.receptions.cancelled_by IS 'Quién la anuló';
COMMENT ON COLUMN public.receptions.cancelled_at IS 'Cuándo se anuló';
COMMENT ON COLUMN public.receptions.created_by IS 'Quién recibió (no puede liberar los lotes en Calidad)';
COMMENT ON COLUMN public.receptions.created_at IS 'Fecha y hora de registro';
CREATE INDEX idx_receptions_po ON public.receptions (purchase_order_id);

CREATE TABLE public.receptions_details (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reception_id UUID NOT NULL REFERENCES public.receptions(id) ON DELETE CASCADE,
    line_no INTEGER NOT NULL CHECK (line_no > 0),
    po_line_id UUID NOT NULL REFERENCES public.purchase_orders_details(id) ON DELETE RESTRICT,
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
    quantity NUMERIC(18, 6) NOT NULL CHECK (quantity > 0),
    stock_quantity NUMERIC(18, 6) NOT NULL CHECK (stock_quantity > 0),
    unit_cost NUMERIC(18, 6) NOT NULL DEFAULT 0,
    lot_id UUID REFERENCES public.lots(id) ON DELETE RESTRICT,
    supplier_lot VARCHAR(40),
    CONSTRAINT uq_receptions_details_line UNIQUE (reception_id, line_no)
);
COMMENT ON TABLE public.receptions_details IS 'Líneas recibidas o devueltas';
COMMENT ON COLUMN public.receptions_details.id IS 'Identificador único';
COMMENT ON COLUMN public.receptions_details.reception_id IS 'Recepción';
COMMENT ON COLUMN public.receptions_details.line_no IS 'Nº de línea';
COMMENT ON COLUMN public.receptions_details.po_line_id IS 'Línea de la orden de compra';
COMMENT ON COLUMN public.receptions_details.product_id IS 'Producto';
COMMENT ON COLUMN public.receptions_details.quantity IS 'Cantidad en la unidad de la orden';
COMMENT ON COLUMN public.receptions_details.stock_quantity IS 'Cantidad en unidad de almacén (cantidad × factor)';
COMMENT ON COLUMN public.receptions_details.unit_cost IS 'Costo por unidad de almacén en moneda base (Precio de Recepción)';
COMMENT ON COLUMN public.receptions_details.lot_id IS 'Lote creado o devuelto';
COMMENT ON COLUMN public.receptions_details.supplier_lot IS 'Código Lote del Proveedor';

-- --------------------------------------------------------------- Lotes: origen de compra
ALTER TABLE public.lots
    ADD COLUMN supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
    ADD COLUMN purchase_order_id UUID REFERENCES public.purchase_orders(id) ON DELETE SET NULL;
COMMENT ON COLUMN public.lots.supplier_id IS 'Código del Proveedor del lote';
COMMENT ON COLUMN public.lots.purchase_order_id IS 'Nº Orden de Compra con que se adquirió el lote';

-- --------------------------------------------------------------- Triggers
DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['price_lists', 'buyers', 'suppliers', 'purchase_orders'] LOOP
        EXECUTE format('CREATE TRIGGER trg_%1$s_updated_at BEFORE UPDATE ON public.%1$I
                        FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at()', t);
    END LOOP;
    FOREACH t IN ARRAY ARRAY['price_lists', 'price_lists_items', 'buyers', 'suppliers', 'suppliers_contacts',
                             'purchase_orders', 'purchase_orders_details', 'receptions'] LOOP
        EXECUTE format('CREATE TRIGGER trg_audit_%1$s AFTER INSERT OR UPDATE OR DELETE ON public.%1$I
                        FOR EACH ROW EXECUTE FUNCTION public.fn_audit()', t);
    END LOOP;
END
$$;

-- Recepciones: documento contable, no se borra (se anula).
REVOKE DELETE, TRUNCATE ON public.receptions, public.receptions_details FROM :"app_user";
