-- =====================================================================
--  FabriHub · Fase 13 · Punto de venta (POS), backend
--
--  · pos_terminals: cajas. Cada una despacha de UN almacén, vende con SU lista de precios
--    y numera sus comprobantes con su propio correlativo (next_ticket).
--  · pos_sessions: turnos de caja. Se abren con un fondo y se cierran con un arqueo por
--    medio de pago y moneda (esperado vs contado) en pos_sessions_counts.
--  · pos_sales (+ líneas y pagos): venta de mostrador. Se confirma en UNA transacción:
--    precios e IVA del servidor, salida de inventario VENTA_POS (FEFO) y pagos combinados
--    (cada pago con su moneda y la tasa del día; el vuelto se calcula; IGTF opcional).
--    El comprobante NO es una factura fiscal (la homologación SENIAT queda para otra fase).
--  · users.pos_pin_hash: clave corta de supervisor para descuentos sobre el límite y anulaciones.
--  · pg_trgm: búsqueda rápida de productos por nombre y código.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- --------------------------------------------------------------- Módulos
INSERT INTO public.catalogs_modules (order_list, code, name, description, icon, path, is_public, is_offline, metadata)
VALUES (6, 'POS', 'Punto de venta', 'Cajas, turnos y ventas de mostrador.', 'cash-register', '/pos', FALSE, FALSE, '{"phase":13}')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.catalogs_modules (order_list, code, name, description, icon, path, is_offline, metadata, module_parent_id)
SELECT h.order_list, h.code, h.name, h.description, h.icon, h.path, FALSE, '{"phase":13}'::jsonb, p.id
FROM (VALUES
    (1, 'POS_SALES',     'Ventas de mostrador', 'Vender, consultar comprobantes y anular (supervisor).', 'shopping-bag', '/pos/sales'),
    (2, 'POS_SESSIONS',  'Turnos de caja',      'Apertura con fondo y cierre con arqueo.',               'cash',         '/pos/sessions'),
    (3, 'POS_TERMINALS', 'Cajas',               'Cajas: almacén, lista de precios y correlativo.',       'device-desktop','/pos/terminals')
) AS h(order_list, code, name, description, icon, path)
JOIN public.catalogs_modules p ON p.code = 'POS'
ON CONFLICT (code) DO NOTHING;

-- --------------------------------------------------------------- Concepto de inventario
INSERT INTO public.catalogs_movement_concepts
    (order_list, is_system, code, name, description, movement_type_id, module_code, lot_status_on_entry, allows_unapproved_lots)
SELECT 16, TRUE, 'VENTA_POS', 'Venta de mostrador', 'Salida por venta en caja (POS)', t.id, 'POS', 'approved', FALSE
  FROM public.catalogs_movement_types t WHERE t.code = 'SAL'
ON CONFLICT (code) DO NOTHING;

-- --------------------------------------------------------------- Parámetros y correlativos (por empresa)
INSERT INTO public.parameters (company_id, module_code, order_list, key, name, description, data_type, value, default_value, rules)
SELECT c.id, s.module_code, s.ord, s.key, s.name, s.description, s.data_type, s.value::jsonb, s.value::jsonb, s.rules::jsonb
  FROM public.companies c
 CROSS JOIN (VALUES
    ('POS', 1, 'max_discount_pct', 'Descuento máximo sin supervisor (%)',
        'Un descuento (de línea o global) mayor exige la clave de un supervisor.', 'number', '5', '{"min":0,"max":100}'),
    ('POS', 2, 'igtf_enabled', 'Cobrar IGTF',
        'Aplica el Impuesto a las Grandes Transacciones Financieras a los pagos en divisas. Confírmelo con su contador.', 'boolean', 'false', '{}'),
    ('POS', 3, 'igtf_rate', 'Alícuota del IGTF (%)',
        'Porcentaje sobre la parte del total pagada en divisas.', 'number', '3', '{"min":0,"max":10}'),
    ('POS', 4, 'max_cash_difference', 'Diferencia de arqueo tolerada',
        'Diferencia (en moneda base) a partir de la cual el cierre de turno exige una observación.', 'number', '0', '{"min":0,"max":1000000}')
 ) AS s(module_code, ord, key, name, description, data_type, value, rules)
ON CONFLICT DO NOTHING;

INSERT INTO public.document_sequences (company_id, doc_type, name, module_code, prefix)
SELECT c.id, 'TUR', 'Turno de caja', 'POS', 'TC-' FROM public.companies c
ON CONFLICT DO NOTHING;

-- --------------------------------------------------------------- Clientes: cédula sin dígito verificador
-- En mostrador se vende a personas naturales identificadas solo por su cédula (V-12345678).
ALTER TABLE public.customers DROP CONSTRAINT customers_rif_check;
ALTER TABLE public.customers ADD CONSTRAINT customers_rif_check
    CHECK (rif ~ '^[VEJPG]-[0-9]{8}-[0-9]$' OR rif ~ '^[VE]-[0-9]{5,9}$');
COMMENT ON COLUMN public.customers.rif IS 'RIF (J-12345678-9) o, para personas naturales del POS, cédula (V-12345678)';

-- --------------------------------------------------------------- Clave de supervisor
ALTER TABLE public.users
    ADD COLUMN pos_pin_hash VARCHAR(100),
    ADD COLUMN pos_pin_failures SMALLINT NOT NULL DEFAULT 0,
    ADD COLUMN pos_pin_locked_until TIMESTAMPTZ;
COMMENT ON COLUMN public.users.pos_pin_hash IS 'Clave de supervisor del POS (bcrypt): autoriza descuentos sobre el límite y anulaciones';
COMMENT ON COLUMN public.users.pos_pin_failures IS 'Intentos fallidos seguidos de la clave de supervisor';
COMMENT ON COLUMN public.users.pos_pin_locked_until IS 'Clave de supervisor bloqueada hasta esta fecha por intentos fallidos';

-- --------------------------------------------------------------- Cajas
CREATE TABLE public.pos_terminals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL DEFAULT public.fn_current_company()
        CONSTRAINT fk_pos_terminals_company REFERENCES public.companies(id) ON DELETE RESTRICT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    code VARCHAR(20) NOT NULL CHECK (code ~ '^[A-Z0-9_-]+$'),
    name VARCHAR(80) NOT NULL,
    warehouse_id UUID NOT NULL,
    price_list_id UUID,
    default_customer_id UUID,
    ticket_prefix VARCHAR(10) NOT NULL CHECK (ticket_prefix ~ '^[A-Z0-9-]*$'),
    ticket_padding SMALLINT NOT NULL DEFAULT 8 CHECK (ticket_padding BETWEEN 4 AND 12),
    next_ticket BIGINT NOT NULL DEFAULT 1 CHECK (next_ticket >= 1),
    notes VARCHAR(400),

    metadata JSONB NOT NULL DEFAULT '{}',
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_pos_terminals_company_id UNIQUE (company_id, id),
    CONSTRAINT uq_pos_terminals_code UNIQUE (company_id, code),
    CONSTRAINT uq_pos_terminals_prefix UNIQUE (company_id, ticket_prefix),
    CONSTRAINT fk_pos_terminals_warehouse FOREIGN KEY (company_id, warehouse_id)
        REFERENCES public.warehouses (company_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_pos_terminals_price_list FOREIGN KEY (company_id, price_list_id)
        REFERENCES public.price_lists (company_id, id) ON DELETE SET NULL (price_list_id),
    CONSTRAINT fk_pos_terminals_customer FOREIGN KEY (company_id, default_customer_id)
        REFERENCES public.customers (company_id, id) ON DELETE SET NULL (default_customer_id)
);
COMMENT ON TABLE public.pos_terminals IS 'Cajas del punto de venta';
COMMENT ON COLUMN public.pos_terminals.company_id IS 'Empresa dueña del registro (aislada por RLS)';
COMMENT ON COLUMN public.pos_terminals.code IS 'Código de la caja';
COMMENT ON COLUMN public.pos_terminals.warehouse_id IS 'Almacén del que sale la mercancía vendida';
COMMENT ON COLUMN public.pos_terminals.price_list_id IS 'Lista de precios de venta de la caja (sin ella: la del cliente o el precio de referencia)';
COMMENT ON COLUMN public.pos_terminals.default_customer_id IS 'Cliente por defecto (sin él: «Consumidor final»)';
COMMENT ON COLUMN public.pos_terminals.ticket_prefix IS 'Prefijo de los comprobantes de la caja (único por empresa)';
COMMENT ON COLUMN public.pos_terminals.next_ticket IS 'Siguiente número de comprobante (correlativo propio de la caja)';

-- --------------------------------------------------------------- Turnos
CREATE TABLE public.pos_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL DEFAULT public.fn_current_company()
        CONSTRAINT fk_pos_sessions_company REFERENCES public.companies(id) ON DELETE RESTRICT,
    number VARCHAR(30) NOT NULL,
    terminal_id UUID NOT NULL,
    cashier_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    status VARCHAR(10) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at TIMESTAMPTZ,
    closed_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    sales_count INTEGER,
    sales_total NUMERIC(20, 2),
    difference_total NUMERIC(20, 2),
    opening_notes VARCHAR(400),
    closing_notes VARCHAR(800),

    CONSTRAINT uq_pos_sessions_company_id UNIQUE (company_id, id),
    CONSTRAINT uq_pos_sessions_number UNIQUE (company_id, number),
    CONSTRAINT fk_pos_sessions_terminal FOREIGN KEY (company_id, terminal_id)
        REFERENCES public.pos_terminals (company_id, id) ON DELETE RESTRICT,
    CONSTRAINT ck_pos_sessions_closed CHECK ((status = 'closed') = (closed_at IS NOT NULL))
);
COMMENT ON TABLE public.pos_sessions IS 'Turnos de caja: apertura con fondo, ventas y cierre con arqueo';
COMMENT ON COLUMN public.pos_sessions.company_id IS 'Empresa dueña del registro (aislada por RLS)';
COMMENT ON COLUMN public.pos_sessions.number IS 'Número del turno (correlativo TUR)';
COMMENT ON COLUMN public.pos_sessions.cashier_id IS 'Cajero que abrió el turno (el único que vende en él)';
COMMENT ON COLUMN public.pos_sessions.sales_total IS 'Total vendido en el turno (moneda base, sin anuladas), al cerrar';
COMMENT ON COLUMN public.pos_sessions.difference_total IS 'Suma de diferencias del arqueo en moneda base (contado − esperado), al cerrar';

-- Una caja tiene a lo sumo un turno abierto, y un cajero también
CREATE UNIQUE INDEX uq_pos_sessions_open_terminal ON public.pos_sessions (company_id, terminal_id) WHERE status = 'open';
CREATE UNIQUE INDEX uq_pos_sessions_open_cashier ON public.pos_sessions (company_id, cashier_id) WHERE status = 'open';

CREATE TABLE public.pos_sessions_counts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL DEFAULT public.fn_current_company()
        CONSTRAINT fk_pos_sessions_counts_company REFERENCES public.companies(id) ON DELETE RESTRICT,
    session_id UUID NOT NULL,
    method VARCHAR(10) NOT NULL CHECK (method IN ('cash', 'card', 'mobile', 'transfer')),
    currency_id UUID NOT NULL REFERENCES public.catalogs_currencies(id) ON DELETE RESTRICT,
    opening_amount NUMERIC(20, 2) NOT NULL DEFAULT 0 CHECK (opening_amount >= 0),
    expected_amount NUMERIC(20, 2),
    counted_amount NUMERIC(20, 2) CHECK (counted_amount >= 0),
    difference NUMERIC(20, 2),
    exchange_rate NUMERIC(20, 6),

    CONSTRAINT uq_pos_sessions_counts UNIQUE (company_id, session_id, method, currency_id),
    CONSTRAINT fk_pos_sessions_counts_session FOREIGN KEY (company_id, session_id)
        REFERENCES public.pos_sessions (company_id, id) ON DELETE CASCADE
);
COMMENT ON TABLE public.pos_sessions_counts IS 'Arqueo del turno por medio de pago y moneda: fondo, esperado, contado y diferencia';
COMMENT ON COLUMN public.pos_sessions_counts.company_id IS 'Empresa dueña del registro (aislada por RLS)';
COMMENT ON COLUMN public.pos_sessions_counts.opening_amount IS 'Fondo de apertura (solo efectivo)';
COMMENT ON COLUMN public.pos_sessions_counts.expected_amount IS 'Fondo + cobrado − vuelto entregado, en la moneda de la fila (al cerrar)';
COMMENT ON COLUMN public.pos_sessions_counts.counted_amount IS 'Lo contado por el cajero (al cerrar)';
COMMENT ON COLUMN public.pos_sessions_counts.exchange_rate IS 'Tasa usada para llevar la diferencia a moneda base';

-- --------------------------------------------------------------- Ventas
CREATE TABLE public.pos_sales (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL DEFAULT public.fn_current_company()
        CONSTRAINT fk_pos_sales_company REFERENCES public.companies(id) ON DELETE RESTRICT,
    ticket_number VARCHAR(30) NOT NULL,
    status VARCHAR(10) NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'voided')),
    sale_date DATE NOT NULL DEFAULT CURRENT_DATE,
    terminal_id UUID NOT NULL,
    session_id UUID NOT NULL,
    warehouse_id UUID NOT NULL,
    price_list_id UUID,
    customer_id UUID NOT NULL,
    currency_id UUID NOT NULL REFERENCES public.catalogs_currencies(id) ON DELETE RESTRICT,

    discount_pct NUMERIC(7, 4) NOT NULL DEFAULT 0 CHECK (discount_pct BETWEEN 0 AND 100),
    subtotal NUMERIC(20, 2) NOT NULL,
    discount_amount NUMERIC(20, 2) NOT NULL DEFAULT 0,
    taxable_amount NUMERIC(20, 2) NOT NULL,
    tax_amount NUMERIC(20, 2) NOT NULL,
    total NUMERIC(20, 2) NOT NULL,
    igtf_rate NUMERIC(7, 4) NOT NULL DEFAULT 0,
    igtf_base NUMERIC(20, 2) NOT NULL DEFAULT 0,
    igtf_amount NUMERIC(20, 2) NOT NULL DEFAULT 0,
    grand_total NUMERIC(20, 2) NOT NULL,
    paid_amount NUMERIC(20, 2) NOT NULL,
    change_amount NUMERIC(20, 2) NOT NULL DEFAULT 0 CHECK (change_amount >= 0),
    change_currency_id UUID REFERENCES public.catalogs_currencies(id) ON DELETE RESTRICT,
    change_in_currency NUMERIC(20, 2),
    cost_amount NUMERIC(22, 6),
    taxes_detail JSONB NOT NULL DEFAULT '{}',

    movement_id UUID,
    discount_authorized_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    notes VARCHAR(400),

    voided_at TIMESTAMPTZ,
    voided_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    void_authorized_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    void_reason VARCHAR(400),

    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_pos_sales_company_id UNIQUE (company_id, id),
    CONSTRAINT uq_pos_sales_ticket UNIQUE (company_id, ticket_number),
    CONSTRAINT fk_pos_sales_terminal FOREIGN KEY (company_id, terminal_id) REFERENCES public.pos_terminals (company_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_pos_sales_session FOREIGN KEY (company_id, session_id) REFERENCES public.pos_sessions (company_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_pos_sales_warehouse FOREIGN KEY (company_id, warehouse_id) REFERENCES public.warehouses (company_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_pos_sales_price_list FOREIGN KEY (company_id, price_list_id)
        REFERENCES public.price_lists (company_id, id) ON DELETE SET NULL (price_list_id),
    CONSTRAINT fk_pos_sales_customer FOREIGN KEY (company_id, customer_id) REFERENCES public.customers (company_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_pos_sales_movement FOREIGN KEY (company_id, movement_id)
        REFERENCES public.inventory_movements (company_id, id) ON DELETE RESTRICT,
    CONSTRAINT ck_pos_sales_voided CHECK ((status = 'voided') = (voided_at IS NOT NULL))
);
COMMENT ON TABLE public.pos_sales IS 'Ventas de mostrador. El comprobante NO es una factura fiscal';
COMMENT ON COLUMN public.pos_sales.company_id IS 'Empresa dueña del registro (aislada por RLS)';
COMMENT ON COLUMN public.pos_sales.ticket_number IS 'Número de comprobante: prefijo de la caja + su correlativo';
COMMENT ON COLUMN public.pos_sales.currency_id IS 'Moneda del documento (la moneda base de la empresa)';
COMMENT ON COLUMN public.pos_sales.total IS 'Total con IVA, sin IGTF';
COMMENT ON COLUMN public.pos_sales.igtf_base IS 'Parte del total pagada en divisas (moneda base), sobre la que se calcula el IGTF';
COMMENT ON COLUMN public.pos_sales.grand_total IS 'Total a pagar: total + IGTF';
COMMENT ON COLUMN public.pos_sales.paid_amount IS 'Suma de los pagos en moneda base';
COMMENT ON COLUMN public.pos_sales.change_amount IS 'Vuelto en moneda base (pagado − total a pagar), entregado en efectivo';
COMMENT ON COLUMN public.pos_sales.change_in_currency IS 'Vuelto expresado en la moneda en que se entregó';
COMMENT ON COLUMN public.pos_sales.movement_id IS 'Salida de inventario VENTA_POS (NULL si solo hay servicios)';
COMMENT ON COLUMN public.pos_sales.discount_authorized_by IS 'Supervisor que autorizó un descuento sobre el límite';
COMMENT ON COLUMN public.pos_sales.void_authorized_by IS 'Supervisor que autorizó la anulación';

CREATE INDEX idx_pos_sales_session ON public.pos_sales (session_id);
CREATE INDEX idx_pos_sales_date ON public.pos_sales (company_id, sale_date);
CREATE INDEX idx_pos_sales_customer ON public.pos_sales (customer_id);

CREATE TABLE public.pos_sales_details (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL DEFAULT public.fn_current_company()
        CONSTRAINT fk_pos_sales_details_company REFERENCES public.companies(id) ON DELETE RESTRICT,
    sale_id UUID NOT NULL,
    line_no INTEGER NOT NULL CHECK (line_no >= 1),
    product_id UUID NOT NULL,
    unit_id UUID NOT NULL REFERENCES public.catalogs_units(id) ON DELETE RESTRICT,
    unit_factor NUMERIC(18, 6) NOT NULL CHECK (unit_factor > 0),
    quantity NUMERIC(18, 6) NOT NULL CHECK (quantity > 0),
    stock_quantity NUMERIC(18, 6) NOT NULL CHECK (stock_quantity > 0),
    unit_price NUMERIC(18, 4) NOT NULL CHECK (unit_price >= 0),
    price_source VARCHAR(10),
    discount_pct NUMERIC(7, 4) NOT NULL DEFAULT 0 CHECK (discount_pct BETWEEN 0 AND 100),
    treatment_id UUID REFERENCES public.fiscal_treatments(id) ON DELETE RESTRICT,
    tax_rate NUMERIC(7, 4) NOT NULL DEFAULT 0,
    net_amount NUMERIC(20, 2) NOT NULL,
    tax_amount NUMERIC(20, 2) NOT NULL,
    unit_cost NUMERIC(22, 6),

    CONSTRAINT uq_pos_sales_details_line UNIQUE (company_id, sale_id, line_no),
    CONSTRAINT fk_pos_sales_details_sale FOREIGN KEY (company_id, sale_id) REFERENCES public.pos_sales (company_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_pos_sales_details_product FOREIGN KEY (company_id, product_id) REFERENCES public.products (company_id, id) ON DELETE RESTRICT
);
COMMENT ON TABLE public.pos_sales_details IS 'Líneas de la venta de mostrador';
COMMENT ON COLUMN public.pos_sales_details.company_id IS 'Empresa dueña del registro (aislada por RLS)';
COMMENT ON COLUMN public.pos_sales_details.stock_quantity IS 'Cantidad en unidad de almacén (quantity × unit_factor)';
COMMENT ON COLUMN public.pos_sales_details.unit_cost IS 'Costo unitario (unidad de almacén) de la salida';
CREATE INDEX idx_pos_sales_details_product ON public.pos_sales_details (product_id);

CREATE TABLE public.pos_sales_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL DEFAULT public.fn_current_company()
        CONSTRAINT fk_pos_sales_payments_company REFERENCES public.companies(id) ON DELETE RESTRICT,
    sale_id UUID NOT NULL,
    line_no INTEGER NOT NULL CHECK (line_no >= 1),
    method VARCHAR(10) NOT NULL CHECK (method IN ('cash', 'card', 'mobile', 'transfer')),
    currency_id UUID NOT NULL REFERENCES public.catalogs_currencies(id) ON DELETE RESTRICT,
    amount NUMERIC(20, 2) NOT NULL CHECK (amount > 0),
    exchange_rate NUMERIC(20, 6) NOT NULL CHECK (exchange_rate > 0),
    amount_base NUMERIC(20, 2) NOT NULL CHECK (amount_base > 0),
    reference VARCHAR(60),

    CONSTRAINT uq_pos_sales_payments_line UNIQUE (company_id, sale_id, line_no),
    CONSTRAINT fk_pos_sales_payments_sale FOREIGN KEY (company_id, sale_id) REFERENCES public.pos_sales (company_id, id) ON DELETE CASCADE
);
COMMENT ON TABLE public.pos_sales_payments IS 'Pagos de la venta: medio, moneda, tasa del día y equivalente en moneda base';
COMMENT ON COLUMN public.pos_sales_payments.company_id IS 'Empresa dueña del registro (aislada por RLS)';
COMMENT ON COLUMN public.pos_sales_payments.method IS 'cash (efectivo), card (punto de venta), mobile (pago móvil) o transfer (transferencia)';
COMMENT ON COLUMN public.pos_sales_payments.exchange_rate IS 'Tasa de la moneda del pago a moneda base en la fecha de la venta';
COMMENT ON COLUMN public.pos_sales_payments.reference IS 'Referencia bancaria (punto, pago móvil o transferencia)';

-- --------------------------------------------------------------- Índices, RLS y triggers
CREATE INDEX idx_pos_terminals_company ON public.pos_terminals (company_id);
CREATE INDEX idx_pos_sessions_company ON public.pos_sessions (company_id);
CREATE INDEX idx_pos_sessions_counts_company ON public.pos_sessions_counts (company_id);
CREATE INDEX idx_pos_sales_company ON public.pos_sales (company_id);
CREATE INDEX idx_pos_sales_details_company ON public.pos_sales_details (company_id);
CREATE INDEX idx_pos_sales_payments_company ON public.pos_sales_payments (company_id);

DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['pos_terminals', 'pos_sessions', 'pos_sessions_counts', 'pos_sales', 'pos_sales_details', 'pos_sales_payments'] LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('CREATE POLICY p_company_isolation ON public.%I
                          USING (company_id = (SELECT public.fn_current_company()))
                          WITH CHECK (company_id = (SELECT public.fn_current_company()))', t);
        EXECUTE format('CREATE TRIGGER trg_audit_%1$s AFTER INSERT OR UPDATE OR DELETE ON public.%1$I
                        FOR EACH ROW EXECUTE FUNCTION public.fn_audit()', t);
    END LOOP;
END
$$;

CREATE TRIGGER trg_pos_terminals_updated_at BEFORE UPDATE ON public.pos_terminals
    FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

-- Las ventas no se borran: se anulan
REVOKE DELETE ON public.pos_sales, public.pos_sales_details, public.pos_sales_payments FROM :"app_user";

-- --------------------------------------------------------------- Búsqueda de productos (POS)
CREATE INDEX idx_products_name_trgm ON public.products USING gin (name gin_trgm_ops);
CREATE INDEX idx_products_code_trgm ON public.products USING gin (code gin_trgm_ops);

-- --------------------------------------------------------------- Auditoría: la clave de supervisor no se registra
CREATE OR REPLACE FUNCTION public.fn_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_ignored TEXT[] := ARRAY['password_hash', 'failed_attempts', 'locked_until', 'logins',
                              'last_login_at', 'updated_at',
                              'pos_pin_hash', 'pos_pin_failures', 'pos_pin_locked_until', 'next_ticket'];
    v_old JSONB;
    v_new JSONB;
    v_changed TEXT[];
    v_key TEXT;
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
        v_old := to_jsonb(OLD);
        FOREACH v_key IN ARRAY v_ignored LOOP v_old := v_old - v_key; END LOOP;
    END IF;
    IF TG_OP IN ('UPDATE', 'INSERT') THEN
        v_new := to_jsonb(NEW);
        FOREACH v_key IN ARRAY v_ignored LOOP v_new := v_new - v_key; END LOOP;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        SELECT array_agg(n.key ORDER BY n.key)
          INTO v_changed
          FROM jsonb_each(v_new) n
         WHERE n.value IS DISTINCT FROM v_old -> n.key;
        IF v_changed IS NULL THEN
            RETURN NEW;
        END IF;
    END IF;

    INSERT INTO public.audit_log (table_name, record_id, action, old_data, new_data, changed_fields, user_id, trace_id, company_id)
    VALUES (
        TG_TABLE_NAME,
        COALESCE(v_new ->> 'id', v_old ->> 'id'),
        LEFT(TG_OP, 1),
        v_old,
        v_new,
        v_changed,
        public.fn_current_app_user(),
        NULLIF(current_setting('app.trace_id', true), '')::uuid,
        COALESCE(v_new ->> 'company_id', v_old ->> 'company_id',
                 CASE WHEN TG_TABLE_NAME = 'companies' THEN COALESCE(v_new ->> 'id', v_old ->> 'id') END)::uuid
    );

    RETURN COALESCE(NEW, OLD);
END;
$$;
