-- =====================================================================
--  FabriHub · 20261004_0601_sales.sql   (fase 6 · Ventas)
--  Tesis 4.2.2.1 (Subsistema de Ventas): Vendedores, Clientes, Contacto
--  Clientes, Lista de Precios Cliente (price_lists scope 'sales'),
--  Orden de Venta + Detalles y Nota de Entrega.
--
--  Ciclo de la orden de venta:
--    draft ──confirmar──▶ confirmed ──despacho──▶ partially_delivered ──▶ delivered
--      │        └─(excede crédito)─▶ pending_approval ──aprobar (otra persona)──▶ confirmed
--      └ cancelled (sin despachos)                      partially_delivered ──cerrar──▶ closed
--    · Confirmar RESERVA existencia por FEFO (stock_reservations, fase 5); lo que no alcanza
--      queda como pedido pendiente (BackOrder) si SALES.allow_backorder.
--    · La nota de entrega genera una salida DESP_VENTA: primero lo reservado y luego lo libre,
--      siempre en orden FEFO si SALES.enforce_fefo.
-- =====================================================================

-- --------------------------------------------------------------- Vendedores
CREATE TABLE public.sellers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    order_list INTEGER NOT NULL DEFAULT 0,
    code VARCHAR(20) NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9_-]+$'),
    name VARCHAR(120) NOT NULL,
    description VARCHAR(400),
    phone VARCHAR(30),
    email VARCHAR(200),
    commission_pct NUMERIC(6, 3) NOT NULL DEFAULT 0 CHECK (commission_pct BETWEEN 0 AND 100),
    metadata JSONB NOT NULL DEFAULT '{}',
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE public.sellers IS 'Vendedores (tesis: Clase Vendedores)';
COMMENT ON COLUMN public.sellers.id IS 'Identificador único';
COMMENT ON COLUMN public.sellers.is_active IS 'Activo';
COMMENT ON COLUMN public.sellers.order_list IS 'Orden de presentación';
COMMENT ON COLUMN public.sellers.code IS 'Código del Vendedor';
COMMENT ON COLUMN public.sellers.name IS 'Nombre del vendedor';
COMMENT ON COLUMN public.sellers.description IS 'Observaciones';
COMMENT ON COLUMN public.sellers.phone IS 'Teléfono';
COMMENT ON COLUMN public.sellers.email IS 'Correo';
COMMENT ON COLUMN public.sellers.commission_pct IS 'Comisión sobre la venta neta (%)';
COMMENT ON COLUMN public.sellers.metadata IS 'Datos adicionales libres';
COMMENT ON COLUMN public.sellers.created_by IS 'Usuario que lo creó';
COMMENT ON COLUMN public.sellers.updated_by IS 'Último usuario que lo modificó';
COMMENT ON COLUMN public.sellers.created_at IS 'Fecha de creación';
COMMENT ON COLUMN public.sellers.updated_at IS 'Fecha de última modificación';

-- --------------------------------------------------------------- Clientes
CREATE TABLE public.customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    code VARCHAR(20) NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9_-]+$'),
    legal_name VARCHAR(160) NOT NULL,
    trade_name VARCHAR(120),
    rif VARCHAR(12) NOT NULL UNIQUE CHECK (rif ~ '^[VEJPG]-[0-9]{8}-[0-9]$'),
    phones JSONB NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(phones) = 'array'),
    email VARCHAR(200),
    address VARCHAR(400),
    delivery_address VARCHAR(400),
    city VARCHAR(80),
    state VARCHAR(80),
    country VARCHAR(80) NOT NULL DEFAULT 'Venezuela',
    notes VARCHAR(800),

    payment_term_id UUID REFERENCES public.catalogs_payment_terms(id) ON DELETE RESTRICT,
    delivery_term_id UUID REFERENCES public.catalogs_delivery_terms(id) ON DELETE RESTRICT,
    delivery_method_id UUID REFERENCES public.catalogs_delivery_methods(id) ON DELETE RESTRICT,
    zone_id UUID REFERENCES public.catalogs_zones(id) ON DELETE RESTRICT,
    business_type_id UUID REFERENCES public.catalogs_business_types(id) ON DELETE RESTRICT,
    seller_id UUID REFERENCES public.sellers(id) ON DELETE RESTRICT,
    price_list_id UUID REFERENCES public.price_lists(id) ON DELETE RESTRICT,
    fiscal_treatment_id UUID REFERENCES public.fiscal_treatments(id) ON DELETE RESTRICT,
    currency_id UUID REFERENCES public.catalogs_currencies(id) ON DELETE RESTRICT,
    is_withholding_agent BOOLEAN NOT NULL DEFAULT FALSE,
    credit_limit NUMERIC(20, 2) CHECK (credit_limit IS NULL OR credit_limit >= 0),
    receivable_account VARCHAR(30),
    income_account VARCHAR(30),

    metadata JSONB NOT NULL DEFAULT '{}',
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE public.customers IS 'Clientes (tesis: Clase Clientes)';
COMMENT ON COLUMN public.customers.id IS 'Identificador único';
COMMENT ON COLUMN public.customers.is_active IS 'Activo: se le puede vender';
COMMENT ON COLUMN public.customers.code IS 'Código del Cliente';
COMMENT ON COLUMN public.customers.legal_name IS 'Razón social';
COMMENT ON COLUMN public.customers.trade_name IS 'Nombre comercial';
COMMENT ON COLUMN public.customers.rif IS 'RIF (J-12345678-9)';
COMMENT ON COLUMN public.customers.phones IS 'Teléfonos (Teléfono/Fax 1…3 de la tesis, normalizados)';
COMMENT ON COLUMN public.customers.email IS 'Correo';
COMMENT ON COLUMN public.customers.address IS 'Dirección fiscal';
COMMENT ON COLUMN public.customers.delivery_address IS 'Dirección de despacho por defecto';
COMMENT ON COLUMN public.customers.city IS 'Ciudad';
COMMENT ON COLUMN public.customers.state IS 'Estado';
COMMENT ON COLUMN public.customers.country IS 'País';
COMMENT ON COLUMN public.customers.notes IS 'Observaciones';
COMMENT ON COLUMN public.customers.payment_term_id IS 'Condición de pago';
COMMENT ON COLUMN public.customers.delivery_term_id IS 'Condición de entrega';
COMMENT ON COLUMN public.customers.delivery_method_id IS 'Método de entrega';
COMMENT ON COLUMN public.customers.zone_id IS 'Zona';
COMMENT ON COLUMN public.customers.business_type_id IS 'Tipo de negocio';
COMMENT ON COLUMN public.customers.seller_id IS 'Vendedor asignado';
COMMENT ON COLUMN public.customers.price_list_id IS 'Lista de precios del cliente';
COMMENT ON COLUMN public.customers.fiscal_treatment_id IS 'Tratamiento fiscal del cliente';
COMMENT ON COLUMN public.customers.currency_id IS 'Moneda de facturación por defecto';
COMMENT ON COLUMN public.customers.is_withholding_agent IS 'Contribuyente especial: nos retiene IVA al pagar';
COMMENT ON COLUMN public.customers.credit_limit IS 'Límite de crédito en moneda base (NULL = sin control)';
COMMENT ON COLUMN public.customers.receivable_account IS 'Cuenta contable por cobrar';
COMMENT ON COLUMN public.customers.income_account IS 'Cuenta contable de ingresos';
COMMENT ON COLUMN public.customers.metadata IS 'Datos adicionales libres';
COMMENT ON COLUMN public.customers.created_by IS 'Usuario que lo creó';
COMMENT ON COLUMN public.customers.updated_by IS 'Último usuario que lo modificó';
COMMENT ON COLUMN public.customers.created_at IS 'Fecha de creación';
COMMENT ON COLUMN public.customers.updated_at IS 'Fecha de última modificación';

CREATE TABLE public.customers_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
    name VARCHAR(120) NOT NULL,
    position VARCHAR(80),
    phone VARCHAR(30),
    email VARCHAR(200),
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE public.customers_contacts IS 'Contactos del cliente (tesis: Clase Contacto Clientes)';
COMMENT ON COLUMN public.customers_contacts.id IS 'Identificador único';
COMMENT ON COLUMN public.customers_contacts.customer_id IS 'Cliente';
COMMENT ON COLUMN public.customers_contacts.name IS 'Nombre del contacto';
COMMENT ON COLUMN public.customers_contacts.position IS 'Cargo';
COMMENT ON COLUMN public.customers_contacts.phone IS 'Teléfono';
COMMENT ON COLUMN public.customers_contacts.email IS 'Correo';
COMMENT ON COLUMN public.customers_contacts.is_primary IS 'Contacto principal';
COMMENT ON COLUMN public.customers_contacts.created_by IS 'Usuario que lo registró';
COMMENT ON COLUMN public.customers_contacts.created_at IS 'Fecha de registro';
CREATE UNIQUE INDEX uq_customers_contacts_primary ON public.customers_contacts (customer_id) WHERE is_primary;

-- --------------------------------------------------------------- Órdenes de venta
CREATE TABLE public.sales_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    number VARCHAR(30) NOT NULL UNIQUE,
    status VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'pending_approval', 'confirmed', 'partially_delivered', 'delivered', 'closed', 'cancelled')),

    customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
    contact_id UUID REFERENCES public.customers_contacts(id) ON DELETE SET NULL,
    seller_id UUID REFERENCES public.sellers(id) ON DELETE RESTRICT,
    order_date DATE NOT NULL DEFAULT CURRENT_DATE,
    requested_date DATE,
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
    receivable NUMERIC(20, 2) NOT NULL DEFAULT 0,
    taxes_detail JSONB NOT NULL DEFAULT '[]',

    customer_reference VARCHAR(60),
    notes VARCHAR(800),

    confirmed_at TIMESTAMPTZ,
    credit_exposure NUMERIC(20, 2),
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
COMMENT ON TABLE public.sales_orders IS 'Cabecera de la orden de venta (tesis: Clase Orden de Venta)';
COMMENT ON COLUMN public.sales_orders.id IS 'Identificador único';
COMMENT ON COLUMN public.sales_orders.number IS 'Nº de Orden de Venta (correlativo SO)';
COMMENT ON COLUMN public.sales_orders.status IS 'draft, pending_approval (retenida por crédito), confirmed, partially_delivered, delivered, closed o cancelled';
COMMENT ON COLUMN public.sales_orders.customer_id IS 'Cliente';
COMMENT ON COLUMN public.sales_orders.contact_id IS 'Contacto del cliente';
COMMENT ON COLUMN public.sales_orders.seller_id IS 'Vendedor';
COMMENT ON COLUMN public.sales_orders.order_date IS 'Fecha de la orden';
COMMENT ON COLUMN public.sales_orders.requested_date IS 'Fecha de entrega solicitada por el cliente';
COMMENT ON COLUMN public.sales_orders.warehouse_id IS 'Almacén que despacha';
COMMENT ON COLUMN public.sales_orders.delivery_address IS 'Dirección de despacho';
COMMENT ON COLUMN public.sales_orders.currency_id IS 'Moneda del documento';
COMMENT ON COLUMN public.sales_orders.exchange_rate IS 'Tasa a moneda base en la fecha de la orden';
COMMENT ON COLUMN public.sales_orders.payment_term_id IS 'Condición de pago';
COMMENT ON COLUMN public.sales_orders.delivery_term_id IS 'Condición de entrega';
COMMENT ON COLUMN public.sales_orders.delivery_method_id IS 'Método de entrega';
COMMENT ON COLUMN public.sales_orders.discount_pct IS 'Descuento global (%)';
COMMENT ON COLUMN public.sales_orders.subtotal IS 'Suma de líneas antes de descuentos';
COMMENT ON COLUMN public.sales_orders.discount_amount IS 'Descuentos';
COMMENT ON COLUMN public.sales_orders.taxable_amount IS 'Base imponible';
COMMENT ON COLUMN public.sales_orders.tax_amount IS 'IVA';
COMMENT ON COLUMN public.sales_orders.total IS 'Total del documento';
COMMENT ON COLUMN public.sales_orders.withholding_amount IS 'Retenciones que aplicará el cliente (agente de retención)';
COMMENT ON COLUMN public.sales_orders.receivable IS 'Neto a cobrar: total − retenciones';
COMMENT ON COLUMN public.sales_orders.taxes_detail IS 'Desglose de impuestos y retenciones (foto del cálculo)';
COMMENT ON COLUMN public.sales_orders.customer_reference IS 'Referencia del cliente (su orden de compra)';
COMMENT ON COLUMN public.sales_orders.notes IS 'Observaciones';
COMMENT ON COLUMN public.sales_orders.confirmed_at IS 'Fecha de confirmación (reserva de existencia)';
COMMENT ON COLUMN public.sales_orders.credit_exposure IS 'Exposición de crédito del cliente al confirmar (moneda base)';
COMMENT ON COLUMN public.sales_orders.approved_by IS 'Usuario que aprobó el exceso de crédito';
COMMENT ON COLUMN public.sales_orders.approved_at IS 'Fecha de aprobación del crédito';
COMMENT ON COLUMN public.sales_orders.closed_by IS 'Usuario que cerró la orden con pendientes';
COMMENT ON COLUMN public.sales_orders.closed_at IS 'Fecha de cierre';
COMMENT ON COLUMN public.sales_orders.cancel_reason IS 'Motivo de anulación';
COMMENT ON COLUMN public.sales_orders.created_by IS 'Usuario que la creó';
COMMENT ON COLUMN public.sales_orders.updated_by IS 'Último usuario que la modificó';
COMMENT ON COLUMN public.sales_orders.created_at IS 'Fecha de creación';
COMMENT ON COLUMN public.sales_orders.updated_at IS 'Fecha de última modificación';
CREATE INDEX idx_sales_orders_customer ON public.sales_orders (customer_id);
CREATE INDEX idx_sales_orders_status ON public.sales_orders (status);

CREATE TABLE public.sales_orders_details (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sales_order_id UUID NOT NULL REFERENCES public.sales_orders(id) ON DELETE CASCADE,
    line_no INTEGER NOT NULL CHECK (line_no > 0),
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
    unit_id UUID NOT NULL REFERENCES public.catalogs_units(id) ON DELETE RESTRICT,
    unit_factor NUMERIC(18, 6) NOT NULL DEFAULT 1 CHECK (unit_factor > 0),
    quantity NUMERIC(18, 6) NOT NULL CHECK (quantity > 0),
    unit_price NUMERIC(18, 4) NOT NULL CHECK (unit_price >= 0),
    price_source VARCHAR(10),
    discount_pct NUMERIC(7, 4) NOT NULL DEFAULT 0 CHECK (discount_pct BETWEEN 0 AND 100),
    fiscal_treatment_id UUID REFERENCES public.fiscal_treatments(id) ON DELETE RESTRICT,
    tax_rate NUMERIC(7, 4) NOT NULL DEFAULT 0,
    net_amount NUMERIC(20, 2) NOT NULL DEFAULT 0,
    tax_amount NUMERIC(20, 2) NOT NULL DEFAULT 0,
    quantity_delivered NUMERIC(18, 6) NOT NULL DEFAULT 0 CHECK (quantity_delivered >= 0),
    notes VARCHAR(400),
    CONSTRAINT uq_sales_orders_details_line UNIQUE (sales_order_id, line_no)
);
COMMENT ON TABLE public.sales_orders_details IS 'Líneas de la orden de venta (tesis: Clase Detalles Orden de Venta)';
COMMENT ON COLUMN public.sales_orders_details.id IS 'Identificador único';
COMMENT ON COLUMN public.sales_orders_details.sales_order_id IS 'Orden de venta';
COMMENT ON COLUMN public.sales_orders_details.line_no IS 'Nº de línea';
COMMENT ON COLUMN public.sales_orders_details.product_id IS 'Producto';
COMMENT ON COLUMN public.sales_orders_details.unit_id IS 'Unidad de venta de la línea';
COMMENT ON COLUMN public.sales_orders_details.unit_factor IS 'Unidades de almacén por unidad de la línea';
COMMENT ON COLUMN public.sales_orders_details.quantity IS 'Cantidad pedida (unidad de la línea)';
COMMENT ON COLUMN public.sales_orders_details.unit_price IS 'Precio unitario en moneda del documento';
COMMENT ON COLUMN public.sales_orders_details.price_source IS 'Origen del precio: promo, list, product o manual';
COMMENT ON COLUMN public.sales_orders_details.discount_pct IS 'Descuento de línea (%)';
COMMENT ON COLUMN public.sales_orders_details.fiscal_treatment_id IS 'Tratamiento fiscal aplicado';
COMMENT ON COLUMN public.sales_orders_details.tax_rate IS 'Alícuota de IVA aplicada';
COMMENT ON COLUMN public.sales_orders_details.net_amount IS 'Neto de la línea';
COMMENT ON COLUMN public.sales_orders_details.tax_amount IS 'IVA de la línea';
COMMENT ON COLUMN public.sales_orders_details.quantity_delivered IS 'Cantidad despachada (notas de entrega vigentes)';
COMMENT ON COLUMN public.sales_orders_details.notes IS 'Observaciones';

-- --------------------------------------------------------------- Notas de entrega
CREATE TABLE public.delivery_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    number VARCHAR(30) NOT NULL UNIQUE,
    status VARCHAR(10) NOT NULL DEFAULT 'posted' CHECK (status IN ('posted', 'cancelled')),
    sales_order_id UUID NOT NULL REFERENCES public.sales_orders(id) ON DELETE RESTRICT,
    delivery_date DATE NOT NULL DEFAULT CURRENT_DATE,
    warehouse_id UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
    delivery_address VARCHAR(400),
    carrier VARCHAR(120),
    movement_id UUID REFERENCES public.inventory_movements(id) ON DELETE RESTRICT,
    net_amount NUMERIC(20, 2) NOT NULL DEFAULT 0,
    cost_amount NUMERIC(22, 6) NOT NULL DEFAULT 0,
    notes VARCHAR(800),
    cancelled_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    cancelled_at TIMESTAMPTZ,
    cancel_reason VARCHAR(400),
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE public.delivery_notes IS 'Notas de entrega (tesis: Nota de Entrega): despacho de una orden de venta';
COMMENT ON COLUMN public.delivery_notes.id IS 'Identificador único';
COMMENT ON COLUMN public.delivery_notes.number IS 'Nº de Nota de Entrega (correlativo DN)';
COMMENT ON COLUMN public.delivery_notes.status IS 'posted o cancelled (anulada: su movimiento se reversa)';
COMMENT ON COLUMN public.delivery_notes.sales_order_id IS 'Orden de venta despachada';
COMMENT ON COLUMN public.delivery_notes.delivery_date IS 'Fecha de despacho';
COMMENT ON COLUMN public.delivery_notes.warehouse_id IS 'Almacén que despacha';
COMMENT ON COLUMN public.delivery_notes.delivery_address IS 'Dirección de entrega';
COMMENT ON COLUMN public.delivery_notes.carrier IS 'Transportista / chofer';
COMMENT ON COLUMN public.delivery_notes.movement_id IS 'Movimiento DESP_VENTA';
COMMENT ON COLUMN public.delivery_notes.net_amount IS 'Valor de venta neto despachado (moneda del documento)';
COMMENT ON COLUMN public.delivery_notes.cost_amount IS 'Costo de lo despachado (moneda base, costo promedio)';
COMMENT ON COLUMN public.delivery_notes.notes IS 'Observaciones';
COMMENT ON COLUMN public.delivery_notes.cancelled_by IS 'Usuario que la anuló';
COMMENT ON COLUMN public.delivery_notes.cancelled_at IS 'Fecha de anulación';
COMMENT ON COLUMN public.delivery_notes.cancel_reason IS 'Motivo de anulación';
COMMENT ON COLUMN public.delivery_notes.created_by IS 'Usuario que despachó';
COMMENT ON COLUMN public.delivery_notes.created_at IS 'Fecha de registro';
CREATE INDEX idx_delivery_notes_order ON public.delivery_notes (sales_order_id);

CREATE TABLE public.delivery_notes_details (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    delivery_note_id UUID NOT NULL REFERENCES public.delivery_notes(id) ON DELETE CASCADE,
    line_no INTEGER NOT NULL CHECK (line_no > 0),
    so_line_id UUID NOT NULL REFERENCES public.sales_orders_details(id) ON DELETE RESTRICT,
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
    lot_id UUID REFERENCES public.lots(id) ON DELETE RESTRICT,
    quantity NUMERIC(18, 6) NOT NULL CHECK (quantity > 0),
    stock_quantity NUMERIC(18, 6) NOT NULL CHECK (stock_quantity > 0),
    unit_price NUMERIC(18, 4) NOT NULL DEFAULT 0,
    unit_cost NUMERIC(18, 6) NOT NULL DEFAULT 0,
    CONSTRAINT uq_delivery_notes_details_line UNIQUE (delivery_note_id, line_no)
);
COMMENT ON TABLE public.delivery_notes_details IS 'Líneas despachadas, una por lote (trazabilidad lote → cliente)';
COMMENT ON COLUMN public.delivery_notes_details.id IS 'Identificador único';
COMMENT ON COLUMN public.delivery_notes_details.delivery_note_id IS 'Nota de entrega';
COMMENT ON COLUMN public.delivery_notes_details.line_no IS 'Nº de línea';
COMMENT ON COLUMN public.delivery_notes_details.so_line_id IS 'Línea de la orden de venta';
COMMENT ON COLUMN public.delivery_notes_details.product_id IS 'Producto';
COMMENT ON COLUMN public.delivery_notes_details.lot_id IS 'Lote despachado';
COMMENT ON COLUMN public.delivery_notes_details.quantity IS 'Cantidad en unidad de la orden';
COMMENT ON COLUMN public.delivery_notes_details.stock_quantity IS 'Cantidad en unidad de almacén';
COMMENT ON COLUMN public.delivery_notes_details.unit_price IS 'Precio neto unitario (unidad de la orden, moneda del documento)';
COMMENT ON COLUMN public.delivery_notes_details.unit_cost IS 'Costo unitario de salida (unidad de almacén, moneda base)';
CREATE INDEX idx_delivery_notes_details_lot ON public.delivery_notes_details (lot_id);

-- --------------------------------------------------------------- Triggers
DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['sellers', 'customers', 'sales_orders'] LOOP
        EXECUTE format('CREATE TRIGGER trg_%1$s_updated_at BEFORE UPDATE ON public.%1$I
                        FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at()', t);
    END LOOP;
    FOREACH t IN ARRAY ARRAY['sellers', 'customers', 'customers_contacts', 'sales_orders', 'sales_orders_details',
                             'delivery_notes'] LOOP
        EXECUTE format('CREATE TRIGGER trg_audit_%1$s AFTER INSERT OR UPDATE OR DELETE ON public.%1$I
                        FOR EACH ROW EXECUTE FUNCTION public.fn_audit()', t);
    END LOOP;
END
$$;

-- Nota de entrega: documento contable, no se borra (se anula).
REVOKE DELETE, TRUNCATE ON public.delivery_notes, public.delivery_notes_details FROM :"app_user";
