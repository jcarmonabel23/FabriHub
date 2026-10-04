-- =====================================================================
--  FabriHub · 20261004_0303_stock_movements.sql   (fase 3)
--  Tesis 4.2.2.1.1: Productos en Almacenes, Movimientos de Inventarios y
--  Detalles de Movimientos, con sus métodos Entrada al Almacén, Salida del
--  Almacén y Calcular Costos, implementados en la BD (atómicos).
--
--  Normalización de "Productos en Almacenes":
--    stock_balances  → existencia por almacén + producto + lote (y lo reservado)
--    stock_valuation → cantidad y valor por almacén + producto (costo promedio)
--    stock_policies  → stock mínimo / máximo por almacén + producto
--
--  Reglas de los movimientos:
--    · Se crean en borrador y se contabilizan con fn_post_inventory_movement() en la misma
--      transacción; contabilizados son INMUTABLES (no se editan ni borran: se reversan).
--    · Costo promedio ponderado por almacén: las entradas promedian, las salidas salen al promedio.
--    · Un reverso devuelve las cantidades al MISMO costo del movimiento original.
-- =====================================================================

-- --------------------------------------------------------------- Existencias
CREATE TABLE public.stock_balances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
    lot_id UUID REFERENCES public.lots(id) ON DELETE RESTRICT,
    quantity NUMERIC(18, 6) NOT NULL DEFAULT 0,
    reserved NUMERIC(18, 6) NOT NULL DEFAULT 0 CHECK (reserved >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_stock_balances UNIQUE NULLS NOT DISTINCT (warehouse_id, product_id, lot_id)
);
COMMENT ON TABLE public.stock_balances IS 'Existencia por almacén, producto y lote (tesis: Productos en Almacenes)';
COMMENT ON COLUMN public.stock_balances.id IS 'Identificador único';
COMMENT ON COLUMN public.stock_balances.warehouse_id IS 'Almacén';
COMMENT ON COLUMN public.stock_balances.product_id IS 'Producto';
COMMENT ON COLUMN public.stock_balances.lot_id IS 'Lote (NULL si el producto no se maneja por lote)';
COMMENT ON COLUMN public.stock_balances.quantity IS 'Existencia en unidad de almacén';
COMMENT ON COLUMN public.stock_balances.reserved IS 'Asignadas: reservadas para una salida futura (órdenes de producción/venta)';
COMMENT ON COLUMN public.stock_balances.updated_at IS 'Último cambio';
CREATE INDEX idx_stock_balances_product ON public.stock_balances (product_id);

CREATE TABLE public.stock_valuation (
    warehouse_id UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
    quantity NUMERIC(18, 6) NOT NULL DEFAULT 0,
    total_value NUMERIC(22, 6) NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (warehouse_id, product_id)
);
COMMENT ON TABLE public.stock_valuation IS 'Valoración por almacén y producto: costo promedio = total_value / quantity';
COMMENT ON COLUMN public.stock_valuation.warehouse_id IS 'Almacén';
COMMENT ON COLUMN public.stock_valuation.product_id IS 'Producto';
COMMENT ON COLUMN public.stock_valuation.quantity IS 'Cantidad total del producto en el almacén (suma de lotes)';
COMMENT ON COLUMN public.stock_valuation.total_value IS 'Valor del inventario en moneda base';
COMMENT ON COLUMN public.stock_valuation.updated_at IS 'Último cambio';

CREATE TABLE public.stock_policies (
    warehouse_id UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    min_qty NUMERIC(18, 6) NOT NULL DEFAULT 0 CHECK (min_qty >= 0),
    max_qty NUMERIC(18, 6) CHECK (max_qty IS NULL OR max_qty >= min_qty),
    updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (warehouse_id, product_id)
);
COMMENT ON TABLE public.stock_policies IS 'Stock Mínimo y Stock Máximo recomendados por almacén y producto';
COMMENT ON COLUMN public.stock_policies.warehouse_id IS 'Almacén';
COMMENT ON COLUMN public.stock_policies.product_id IS 'Producto';
COMMENT ON COLUMN public.stock_policies.min_qty IS 'Cantidad mínima que garantiza la disponibilidad';
COMMENT ON COLUMN public.stock_policies.max_qty IS 'Cantidad máxima para un funcionamiento eficiente (NULL = sin tope)';
COMMENT ON COLUMN public.stock_policies.updated_by IS 'Usuario que fijó la política';
COMMENT ON COLUMN public.stock_policies.updated_at IS 'Último cambio';

CREATE TRIGGER trg_audit_stock_policies AFTER INSERT OR UPDATE OR DELETE ON public.stock_policies
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit();

-- --------------------------------------------------------------- Movimientos
CREATE TABLE public.inventory_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    number VARCHAR(30) NOT NULL UNIQUE,
    movement_date DATE NOT NULL DEFAULT CURRENT_DATE,

    concept_id UUID NOT NULL REFERENCES public.catalogs_movement_concepts(id) ON DELETE RESTRICT,
    direction VARCHAR(10) NOT NULL CHECK (direction IN ('in', 'out', 'transfer')),
    warehouse_id UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
    target_warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE RESTRICT,

    status VARCHAR(10) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'posted', 'reversed')),
    reversal_of_id UUID UNIQUE REFERENCES public.inventory_movements(id) ON DELETE RESTRICT,
    reversed_by_id UUID REFERENCES public.inventory_movements(id) ON DELETE RESTRICT,

    reference VARCHAR(60),
    notes VARCHAR(800),
    source_module VARCHAR(40) NOT NULL DEFAULT 'INVENTORY',
    source_document_id UUID,

    lines INTEGER,
    total_cost NUMERIC(22, 6),
    posted_at TIMESTAMPTZ,

    metadata JSONB NOT NULL DEFAULT '{}',
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE public.inventory_movements IS 'Movimientos de inventario (tesis: Clase Movimientos de Inventarios). Contabilizados son inmutables';
COMMENT ON COLUMN public.inventory_movements.id IS 'Identificador único';
COMMENT ON COLUMN public.inventory_movements.number IS 'Nº de Transacción (correlativo MOV)';
COMMENT ON COLUMN public.inventory_movements.movement_date IS 'Fecha de Transacción (fecha contable del movimiento)';
COMMENT ON COLUMN public.inventory_movements.concept_id IS 'Concepto (motivo) del movimiento';
COMMENT ON COLUMN public.inventory_movements.direction IS 'Efecto aplicado: in, out o transfer (en un reverso es el inverso del original)';
COMMENT ON COLUMN public.inventory_movements.warehouse_id IS 'Almacén afectado (origen en salidas y traslados, destino en entradas)';
COMMENT ON COLUMN public.inventory_movements.target_warehouse_id IS 'Almacén destino del traslado';
COMMENT ON COLUMN public.inventory_movements.status IS 'draft (solo dentro de la transacción de alta), posted o reversed';
COMMENT ON COLUMN public.inventory_movements.reversal_of_id IS 'Movimiento que este reversa';
COMMENT ON COLUMN public.inventory_movements.reversed_by_id IS 'Movimiento que reversó a este';
COMMENT ON COLUMN public.inventory_movements.reference IS 'Referencia externa (documento, conteo)';
COMMENT ON COLUMN public.inventory_movements.notes IS 'Observaciones';
COMMENT ON COLUMN public.inventory_movements.source_module IS 'Módulo que originó el movimiento (INVENTORY, PURCHASES, SALES, PRODUCTION)';
COMMENT ON COLUMN public.inventory_movements.source_document_id IS 'Documento de origen: orden de compra, venta o producción (tesis: Nº Orden …)';
COMMENT ON COLUMN public.inventory_movements.lines IS 'Cantidad de líneas';
COMMENT ON COLUMN public.inventory_movements.total_cost IS 'Costo total del movimiento';
COMMENT ON COLUMN public.inventory_movements.posted_at IS 'Fecha del Sistema: cuándo se contabilizó';
COMMENT ON COLUMN public.inventory_movements.metadata IS 'Datos adicionales libres';
COMMENT ON COLUMN public.inventory_movements.created_by IS 'Código del Usuario que realizó la transacción';
COMMENT ON COLUMN public.inventory_movements.created_at IS 'Fecha y hora de registro';
CREATE INDEX idx_inventory_movements_date ON public.inventory_movements (movement_date DESC);
CREATE INDEX idx_inventory_movements_wh ON public.inventory_movements (warehouse_id);

CREATE TABLE public.inventory_movements_details (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    movement_id UUID NOT NULL REFERENCES public.inventory_movements(id) ON DELETE CASCADE,
    line_no INTEGER NOT NULL CHECK (line_no > 0),
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
    lot_id UUID REFERENCES public.lots(id) ON DELETE RESTRICT,
    quantity NUMERIC(18, 6) NOT NULL CHECK (quantity > 0),
    unit_cost NUMERIC(18, 6) CHECK (unit_cost >= 0),
    total_cost NUMERIC(22, 6),
    avg_cost_after NUMERIC(18, 6),
    balance_after NUMERIC(18, 6),
    target_avg_cost_after NUMERIC(18, 6),
    target_balance_after NUMERIC(18, 6),
    notes VARCHAR(400),
    CONSTRAINT uq_inventory_movements_details_line UNIQUE (movement_id, line_no)
);
COMMENT ON TABLE public.inventory_movements_details IS 'Líneas de un movimiento (tesis: Clase Detalles de Movimientos de Inventario)';
COMMENT ON COLUMN public.inventory_movements_details.id IS 'Identificador único';
COMMENT ON COLUMN public.inventory_movements_details.movement_id IS 'Movimiento al que pertenece';
COMMENT ON COLUMN public.inventory_movements_details.line_no IS 'Nº de Línea';
COMMENT ON COLUMN public.inventory_movements_details.product_id IS 'Producto';
COMMENT ON COLUMN public.inventory_movements_details.lot_id IS 'Lote (obligatorio si el producto se maneja por lote)';
COMMENT ON COLUMN public.inventory_movements_details.quantity IS 'Cantidad en unidad de almacén';
COMMENT ON COLUMN public.inventory_movements_details.unit_cost IS 'Costo unitario: dato en entradas, costo promedio vigente en salidas';
COMMENT ON COLUMN public.inventory_movements_details.total_cost IS 'Costo de la línea (cantidad × costo unitario)';
COMMENT ON COLUMN public.inventory_movements_details.avg_cost_after IS 'Costo promedio del producto en el almacén después del movimiento';
COMMENT ON COLUMN public.inventory_movements_details.balance_after IS 'Existencia del producto en el almacén después del movimiento (kárdex)';
COMMENT ON COLUMN public.inventory_movements_details.target_avg_cost_after IS 'Traslados: costo promedio en el almacén destino';
COMMENT ON COLUMN public.inventory_movements_details.target_balance_after IS 'Traslados: existencia en el almacén destino';
COMMENT ON COLUMN public.inventory_movements_details.notes IS 'Observaciones de la línea';
CREATE INDEX idx_inventory_movements_details_product ON public.inventory_movements_details (product_id);

ALTER TABLE public.lots
    ADD CONSTRAINT fk_lots_origin_movement FOREIGN KEY (origin_movement_id) REFERENCES public.inventory_movements(id) ON DELETE SET NULL;

-- --------------------------------------------------------------- Inmutabilidad
CREATE OR REPLACE FUNCTION public.fn_inventory_movements_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.status <> 'draft' THEN
            RAISE EXCEPTION 'Los movimientos contabilizados no se eliminan: se reversan' USING ERRCODE = 'P0001';
        END IF;
        RETURN OLD;
    END IF;
    IF OLD.status = 'draft' THEN
        RETURN NEW;
    END IF;
    IF OLD.status = 'posted' AND NEW.status = 'reversed'
       AND (to_jsonb(NEW) - 'status' - 'reversed_by_id') = (to_jsonb(OLD) - 'status' - 'reversed_by_id') THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'El movimiento % está contabilizado y no se puede modificar', OLD.number USING ERRCODE = 'P0001';
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_inventory_movements_details_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_status VARCHAR;
BEGIN
    SELECT status INTO v_status FROM public.inventory_movements WHERE id = COALESCE(OLD.movement_id, NEW.movement_id);
    IF v_status IS DISTINCT FROM 'draft' THEN
        RAISE EXCEPTION 'Las líneas de un movimiento contabilizado no se modifican' USING ERRCODE = 'P0001';
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_inventory_movements_guard BEFORE UPDATE OR DELETE ON public.inventory_movements
    FOR EACH ROW EXECUTE FUNCTION public.fn_inventory_movements_guard();
CREATE TRIGGER trg_inventory_movements_details_guard BEFORE UPDATE OR DELETE ON public.inventory_movements_details
    FOR EACH ROW EXECUTE FUNCTION public.fn_inventory_movements_details_guard();

-- Segunda barrera: la app no tiene DELETE sobre movimientos ni escribe saldos directamente.
REVOKE DELETE, TRUNCATE ON public.inventory_movements, public.inventory_movements_details FROM :"app_user";

-- --------------------------------------------------------------- Entrada al almacén
CREATE OR REPLACE FUNCTION public.fn__stock_in(
    p_warehouse UUID, p_product UUID, p_lot UUID, p_qty NUMERIC, p_unit_cost NUMERIC,
    OUT avg_after NUMERIC, OUT balance_after NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_q NUMERIC;
    v_v NUMERIC;
BEGIN
    INSERT INTO public.stock_valuation (warehouse_id, product_id) VALUES (p_warehouse, p_product)
    ON CONFLICT DO NOTHING;

    SELECT quantity, total_value INTO v_q, v_v
      FROM public.stock_valuation WHERE warehouse_id = p_warehouse AND product_id = p_product FOR UPDATE;

    -- Costo promedio ponderado. Si venía en cero o negativo, el costo arranca con el de la entrada.
    IF v_q <= 0 THEN
        v_v := (v_q + p_qty) * p_unit_cost;
    ELSE
        v_v := v_v + p_qty * p_unit_cost;
    END IF;
    v_q := v_q + p_qty;

    UPDATE public.stock_valuation SET quantity = v_q, total_value = v_v, updated_at = NOW()
     WHERE warehouse_id = p_warehouse AND product_id = p_product;

    INSERT INTO public.stock_balances (warehouse_id, product_id, lot_id, quantity)
    VALUES (p_warehouse, p_product, p_lot, p_qty)
    ON CONFLICT (warehouse_id, product_id, lot_id)
    DO UPDATE SET quantity = public.stock_balances.quantity + EXCLUDED.quantity, updated_at = NOW();

    avg_after := CASE WHEN v_q > 0 THEN round(v_v / v_q, 6) ELSE p_unit_cost END;
    balance_after := v_q;
END;
$$;

COMMENT ON FUNCTION public.fn__stock_in(UUID, UUID, UUID, NUMERIC, NUMERIC) IS 'Interna: entrada al almacén y recálculo del costo promedio (tesis: Entrada al Almacén + Calcular Costos)';

-- --------------------------------------------------------------- Salida del almacén
CREATE OR REPLACE FUNCTION public.fn__stock_out(
    p_warehouse UUID, p_product UUID, p_lot UUID, p_qty NUMERIC, p_fixed_cost NUMERIC, p_check BOOLEAN, p_label TEXT,
    OUT unit_cost NUMERIC, OUT avg_after NUMERIC, OUT balance_after NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_q NUMERIC;
    v_v NUMERIC;
    v_bq NUMERIC;
    v_br NUMERIC;
BEGIN
    INSERT INTO public.stock_valuation (warehouse_id, product_id) VALUES (p_warehouse, p_product)
    ON CONFLICT DO NOTHING;

    SELECT quantity, total_value INTO v_q, v_v
      FROM public.stock_valuation WHERE warehouse_id = p_warehouse AND product_id = p_product FOR UPDATE;

    SELECT quantity, reserved INTO v_bq, v_br
      FROM public.stock_balances
     WHERE warehouse_id = p_warehouse AND product_id = p_product AND lot_id IS NOT DISTINCT FROM p_lot
       FOR UPDATE;

    IF p_check AND COALESCE(v_bq, 0) - COALESCE(v_br, 0) < p_qty THEN
        RAISE EXCEPTION 'Existencia insuficiente de %: disponible %, solicitado %',
            p_label, trim_scale(round(COALESCE(v_bq, 0) - COALESCE(v_br, 0), 6)), trim_scale(round(p_qty, 6))
            USING ERRCODE = 'P0001';
    END IF;

    unit_cost := COALESCE(p_fixed_cost, CASE WHEN v_q > 0 THEN round(v_v / v_q, 6) ELSE 0 END);

    v_q := v_q - p_qty;
    v_v := CASE WHEN v_q = 0 THEN 0
                WHEN v_q < 0 THEN v_q * unit_cost
                ELSE v_v - p_qty * unit_cost END;

    UPDATE public.stock_valuation SET quantity = v_q, total_value = v_v, updated_at = NOW()
     WHERE warehouse_id = p_warehouse AND product_id = p_product;

    INSERT INTO public.stock_balances (warehouse_id, product_id, lot_id, quantity)
    VALUES (p_warehouse, p_product, p_lot, -p_qty)
    ON CONFLICT (warehouse_id, product_id, lot_id)
    DO UPDATE SET quantity = public.stock_balances.quantity + EXCLUDED.quantity, updated_at = NOW();

    avg_after := CASE WHEN v_q > 0 THEN round(v_v / v_q, 6) ELSE unit_cost END;
    balance_after := v_q;
END;
$$;

COMMENT ON FUNCTION public.fn__stock_out(UUID, UUID, UUID, NUMERIC, NUMERIC, BOOLEAN, TEXT) IS 'Interna: salida del almacén al costo promedio (o al costo fijado, en reversos)';

-- --------------------------------------------------------------- Contabilizar
CREATE OR REPLACE FUNCTION public.fn_post_inventory_movement(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    m public.inventory_movements%ROWTYPE;
    c public.catalogs_movement_concepts%ROWTYPE;
    t public.catalogs_movement_types%ROWTYPE;
    p public.products%ROWTYPE;
    l public.lots%ROWTYPE;
    d RECORD;
    r RECORD;
    r2 RECORD;
    v_reversal BOOLEAN;
    v_check BOOLEAN;
    v_allow_negative BOOLEAN;
    v_label TEXT;
    v_total NUMERIC := 0;
    v_lines INTEGER := 0;
BEGIN
    SELECT * INTO m FROM public.inventory_movements WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Movimiento no encontrado' USING ERRCODE = 'P0001';
    END IF;
    IF m.status <> 'draft' THEN
        RAISE EXCEPTION 'El movimiento % ya fue contabilizado', m.number USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO c FROM public.catalogs_movement_concepts WHERE id = m.concept_id;
    SELECT * INTO t FROM public.catalogs_movement_types WHERE id = c.movement_type_id;
    v_reversal := m.reversal_of_id IS NOT NULL;

    IF NOT v_reversal THEN
        IF NOT c.is_active OR NOT t.is_active THEN
            RAISE EXCEPTION 'El concepto % está inactivo', c.code USING ERRCODE = 'P0001';
        END IF;
        IF m.direction <> t.direction THEN
            RAISE EXCEPTION 'El movimiento no corresponde al tipo de su concepto' USING ERRCODE = 'P0001';
        END IF;
    END IF;

    IF m.direction = 'transfer' THEN
        IF m.target_warehouse_id IS NULL OR m.target_warehouse_id = m.warehouse_id THEN
            RAISE EXCEPTION 'Un traslado necesita un almacén destino distinto del origen' USING ERRCODE = 'P0001';
        END IF;
    ELSIF m.target_warehouse_id IS NOT NULL THEN
        RAISE EXCEPTION 'Solo los traslados llevan almacén destino' USING ERRCODE = 'P0001';
    END IF;

    IF NOT v_reversal AND EXISTS (
        SELECT 1 FROM public.warehouses
         WHERE id IN (m.warehouse_id, m.target_warehouse_id) AND NOT is_active) THEN
        RAISE EXCEPTION 'No se mueve inventario en un almacén inactivo' USING ERRCODE = 'P0001';
    END IF;

    v_allow_negative := COALESCE((public.fn_parameter('INVENTORY', 'allow_negative_stock'))::text::boolean, FALSE);
    -- Un reverso siempre verifica existencia: no se puede "des-recibir" lo que ya se consumió.
    v_check := (t.validates_exit OR v_reversal) AND NOT v_allow_negative;

    FOR d IN SELECT * FROM public.inventory_movements_details WHERE movement_id = p_id ORDER BY line_no LOOP
        v_lines := v_lines + 1;
        SELECT * INTO p FROM public.products WHERE id = d.product_id;
        v_label := p.code;

        IF NOT p.is_stockable THEN
            RAISE EXCEPTION 'Línea %: % no es inventariable', d.line_no, p.code USING ERRCODE = 'P0001';
        END IF;
        IF NOT v_reversal AND NOT p.is_active THEN
            RAISE EXCEPTION 'Línea %: el producto % está inactivo', d.line_no, p.code USING ERRCODE = 'P0001';
        END IF;
        IF NOT v_reversal AND p.is_on_hold THEN
            RAISE EXCEPTION 'Línea %: el producto % está retenido', d.line_no, p.code USING ERRCODE = 'P0001';
        END IF;
        IF p.is_lot_controlled AND d.lot_id IS NULL THEN
            RAISE EXCEPTION 'Línea %: % se maneja por lote; indique el lote', d.line_no, p.code USING ERRCODE = 'P0001';
        END IF;
        IF NOT p.is_lot_controlled AND d.lot_id IS NOT NULL THEN
            RAISE EXCEPTION 'Línea %: % no se maneja por lote', d.line_no, p.code USING ERRCODE = 'P0001';
        END IF;

        IF d.lot_id IS NOT NULL THEN
            SELECT * INTO l FROM public.lots WHERE id = d.lot_id;
            IF l.product_id <> d.product_id THEN
                RAISE EXCEPTION 'Línea %: el lote no pertenece al producto %', d.line_no, p.code USING ERRCODE = 'P0001';
            END IF;
            v_label := p.code || ' lote ' || l.lot_code;
            IF NOT v_reversal AND m.direction IN ('out', 'transfer') AND NOT c.allows_unapproved_lots THEN
                IF l.quality_status <> 'approved' THEN
                    RAISE EXCEPTION 'Línea %: el lote % no está liberado por Calidad (estado: %)',
                        d.line_no, l.lot_code, l.quality_status USING ERRCODE = 'P0001';
                END IF;
                IF l.expires_on IS NOT NULL AND l.expires_on < m.movement_date THEN
                    RAISE EXCEPTION 'Línea %: el lote % venció el %', d.line_no, l.lot_code, to_char(l.expires_on, 'DD/MM/YYYY')
                        USING ERRCODE = 'P0001';
                END IF;
            END IF;
        END IF;

        IF m.direction = 'in' THEN
            IF d.unit_cost IS NULL THEN
                RAISE EXCEPTION 'Línea %: indique el costo unitario de entrada', d.line_no USING ERRCODE = 'P0001';
            END IF;
            SELECT * INTO r FROM public.fn__stock_in(m.warehouse_id, d.product_id, d.lot_id, d.quantity, d.unit_cost);
            UPDATE public.inventory_movements_details
               SET total_cost = d.quantity * d.unit_cost, avg_cost_after = r.avg_after, balance_after = r.balance_after
             WHERE id = d.id;
            v_total := v_total + d.quantity * d.unit_cost;

        ELSIF m.direction = 'out' THEN
            SELECT * INTO r FROM public.fn__stock_out(m.warehouse_id, d.product_id, d.lot_id, d.quantity,
                CASE WHEN v_reversal THEN d.unit_cost END, v_check, v_label);
            UPDATE public.inventory_movements_details
               SET unit_cost = r.unit_cost, total_cost = d.quantity * r.unit_cost,
                   avg_cost_after = r.avg_after, balance_after = r.balance_after
             WHERE id = d.id;
            v_total := v_total + d.quantity * r.unit_cost;

        ELSE
            SELECT * INTO r FROM public.fn__stock_out(m.warehouse_id, d.product_id, d.lot_id, d.quantity,
                CASE WHEN v_reversal THEN d.unit_cost END, v_check, v_label);
            SELECT * INTO r2 FROM public.fn__stock_in(m.target_warehouse_id, d.product_id, d.lot_id, d.quantity, r.unit_cost);
            UPDATE public.inventory_movements_details
               SET unit_cost = r.unit_cost, total_cost = d.quantity * r.unit_cost,
                   avg_cost_after = r.avg_after, balance_after = r.balance_after,
                   target_avg_cost_after = r2.avg_after, target_balance_after = r2.balance_after
             WHERE id = d.id;
            v_total := v_total + d.quantity * r.unit_cost;
        END IF;
    END LOOP;

    IF v_lines = 0 THEN
        RAISE EXCEPTION 'El movimiento no tiene líneas' USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.inventory_movements
       SET status = 'posted', lines = v_lines, total_cost = v_total, posted_at = NOW()
     WHERE id = p_id;
END;
$$;

COMMENT ON FUNCTION public.fn_post_inventory_movement(UUID) IS 'Contabiliza un movimiento en borrador: valida reglas, mueve existencias y recalcula costos';

-- --------------------------------------------------------------- Reversar
CREATE OR REPLACE FUNCTION public.fn_reverse_inventory_movement(p_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    o public.inventory_movements%ROWTYPE;
    v_new UUID;
BEGIN
    SELECT * INTO o FROM public.inventory_movements WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Movimiento no encontrado' USING ERRCODE = 'P0001';
    END IF;
    IF o.status <> 'posted' THEN
        RAISE EXCEPTION 'El movimiento % ya fue reversado', o.number USING ERRCODE = 'P0001';
    END IF;
    IF o.reversal_of_id IS NOT NULL THEN
        RAISE EXCEPTION 'Un reverso no se reversa: registre un movimiento nuevo' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.inventory_movements
        (number, movement_date, concept_id, direction, warehouse_id, target_warehouse_id, status,
         reversal_of_id, reference, notes, source_module, source_document_id, created_by)
    VALUES (
        public.fn_next_document_number('MOV'), CURRENT_DATE, o.concept_id,
        CASE o.direction WHEN 'in' THEN 'out' WHEN 'out' THEN 'in' ELSE 'transfer' END,
        CASE WHEN o.direction = 'transfer' THEN o.target_warehouse_id ELSE o.warehouse_id END,
        CASE WHEN o.direction = 'transfer' THEN o.warehouse_id END,
        'draft', o.id, o.number, 'Reverso de ' || o.number, o.source_module, o.source_document_id,
        public.fn_current_app_user())
    RETURNING id INTO v_new;

    INSERT INTO public.inventory_movements_details (movement_id, line_no, product_id, lot_id, quantity, unit_cost)
    SELECT v_new, line_no, product_id, lot_id, quantity, unit_cost
      FROM public.inventory_movements_details WHERE movement_id = o.id;

    PERFORM public.fn_post_inventory_movement(v_new);

    UPDATE public.inventory_movements SET status = 'reversed', reversed_by_id = v_new WHERE id = o.id;
    RETURN v_new;
END;
$$;

COMMENT ON FUNCTION public.fn_reverse_inventory_movement(UUID) IS 'Reversa un movimiento contabilizado con otro de efecto inverso al mismo costo; marca el original';

-- --------------------------------------------------------------- Permisos
-- Las funciones corren con privilegios del dueño (SECURITY DEFINER): la app NO escribe saldos
-- directamente; la única vía para cambiar existencias es contabilizar un movimiento validado.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.stock_balances, public.stock_valuation FROM :"app_user";
REVOKE EXECUTE ON FUNCTION public.fn__stock_in(UUID, UUID, UUID, NUMERIC, NUMERIC) FROM PUBLIC, :"app_user";
REVOKE EXECUTE ON FUNCTION public.fn__stock_out(UUID, UUID, UUID, NUMERIC, NUMERIC, BOOLEAN, TEXT) FROM PUBLIC, :"app_user";
