-- =====================================================================
--  FabriHub · 20261004_0502_production_orders.sql   (fase 5 · Producción)
--  Tesis 2.1.4 (ciclo de la orden de producción) y 4.2.2.1.2: Orden de
--  Producción, Detalle de la Orden y Procesos (seguimiento de tiempos).
--
--  Ciclo:  created → released → in_process → confirmed → closed
--          (planned queda para el MRP de la fase 7; cancelled antes de consumir)
--    · Liberar   = verificar existencia y RESERVAR materiales (FEFO, solo lotes aprobados).
--    · Consumir  = salida CONS_PROD desde lo reservado (descuenta la reserva).
--    · Procesos  = una fila por etapa de la ruta, con horas reales → mano de obra y costo fabril.
--    · Confirmar = entrada ENT_PROD del terminado en un lote NUEVO en cuarentena, al costo real.
--    · Cerrar    = libera reservas sobrantes y fija costo real vs. estándar (variación).
--
--  stock_reservations es genérica (la usará Ventas en la fase 6): un trigger SECURITY DEFINER
--  mantiene stock_balances.reserved, así la app sigue sin poder escribir saldos directamente.
-- =====================================================================

-- --------------------------------------------------------------- Órdenes de producción
CREATE TABLE public.production_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    number VARCHAR(30) NOT NULL UNIQUE,
    status VARCHAR(12) NOT NULL DEFAULT 'created'
        CHECK (status IN ('planned', 'created', 'released', 'in_process', 'confirmed', 'closed', 'cancelled')),
    priority SMALLINT NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),

    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
    formula_id UUID NOT NULL REFERENCES public.formulas(id) ON DELETE RESTRICT,
    route_id UUID REFERENCES public.routes(id) ON DELETE RESTRICT,
    production_center_id UUID REFERENCES public.production_centers(id) ON DELETE RESTRICT,
    materials_warehouse_id UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
    output_warehouse_id UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,

    quantity_planned NUMERIC(18, 6) NOT NULL CHECK (quantity_planned > 0),
    quantity_produced NUMERIC(18, 6) NOT NULL DEFAULT 0 CHECK (quantity_produced >= 0),
    planned_start DATE NOT NULL DEFAULT CURRENT_DATE,
    planned_end DATE,
    lot_code VARCHAR(40) CHECK (lot_code ~ '^[A-Za-z0-9._/-]+$'),
    output_lot_id UUID REFERENCES public.lots(id) ON DELETE RESTRICT,
    output_movement_id UUID REFERENCES public.inventory_movements(id) ON DELETE RESTRICT,

    std_material_cost NUMERIC(22, 6) NOT NULL DEFAULT 0,
    std_labor_cost NUMERIC(22, 6) NOT NULL DEFAULT 0,
    std_overhead_cost NUMERIC(22, 6) NOT NULL DEFAULT 0,
    real_material_cost NUMERIC(22, 6),
    real_labor_cost NUMERIC(22, 6),
    real_overhead_cost NUMERIC(22, 6),
    real_unit_cost NUMERIC(18, 6),
    variance NUMERIC(22, 6),

    notes VARCHAR(800),
    released_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    released_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    confirmed_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    confirmed_at TIMESTAMPTZ,
    closed_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    closed_at TIMESTAMPTZ,
    cancelled_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    cancelled_at TIMESTAMPTZ,
    cancel_reason VARCHAR(400),

    metadata JSONB NOT NULL DEFAULT '{}',
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT ck_production_orders_dates CHECK (planned_end IS NULL OR planned_end >= planned_start)
);
COMMENT ON TABLE public.production_orders IS 'Órdenes de producción (tesis: Clase Orden de Producción) con su ciclo de vida y costeo';
COMMENT ON COLUMN public.production_orders.id IS 'Identificador único';
COMMENT ON COLUMN public.production_orders.number IS 'Nº de Orden de Producción (correlativo MO)';
COMMENT ON COLUMN public.production_orders.status IS 'planned, created, released, in_process, confirmed, closed o cancelled';
COMMENT ON COLUMN public.production_orders.priority IS 'Prioridad (1 = más urgente)';
COMMENT ON COLUMN public.production_orders.product_id IS 'Producto a fabricar';
COMMENT ON COLUMN public.production_orders.formula_id IS 'Fórmula usada (copiada a los materiales al crear)';
COMMENT ON COLUMN public.production_orders.route_id IS 'Ruta (copiada a los procesos al crear)';
COMMENT ON COLUMN public.production_orders.production_center_id IS 'Centro de producción';
COMMENT ON COLUMN public.production_orders.materials_warehouse_id IS 'Almacén por defecto de los materiales';
COMMENT ON COLUMN public.production_orders.output_warehouse_id IS 'Almacén que recibe el producto fabricado';
COMMENT ON COLUMN public.production_orders.quantity_planned IS 'Cantidad a fabricar (unidad de almacén del producto)';
COMMENT ON COLUMN public.production_orders.quantity_produced IS 'Cantidad realmente fabricada (al confirmar)';
COMMENT ON COLUMN public.production_orders.planned_start IS 'Fecha de inicio planificada';
COMMENT ON COLUMN public.production_orders.planned_end IS 'Fecha de fin planificada';
COMMENT ON COLUMN public.production_orders.lot_code IS 'Código del lote a fabricar';
COMMENT ON COLUMN public.production_orders.output_lot_id IS 'Lote creado al confirmar';
COMMENT ON COLUMN public.production_orders.output_movement_id IS 'Movimiento ENT_PROD de la confirmación';
COMMENT ON COLUMN public.production_orders.std_material_cost IS 'Costo estándar de materiales para la cantidad planificada';
COMMENT ON COLUMN public.production_orders.std_labor_cost IS 'Costo estándar de mano de obra (horas teóricas × tarifa)';
COMMENT ON COLUMN public.production_orders.std_overhead_cost IS 'Costo fabril estándar (horas teóricas × tarifa)';
COMMENT ON COLUMN public.production_orders.real_material_cost IS 'Costo real de los materiales consumidos';
COMMENT ON COLUMN public.production_orders.real_labor_cost IS 'Mano de obra real (horas reales × tarifa)';
COMMENT ON COLUMN public.production_orders.real_overhead_cost IS 'Costo fabril real (horas reales × tarifa)';
COMMENT ON COLUMN public.production_orders.real_unit_cost IS 'Costo real por unidad fabricada';
COMMENT ON COLUMN public.production_orders.variance IS 'Variación: costo real − costo estándar de lo fabricado (positivo = desfavorable)';
COMMENT ON COLUMN public.production_orders.notes IS 'Observaciones';
COMMENT ON COLUMN public.production_orders.released_by IS 'Usuario que liberó la orden';
COMMENT ON COLUMN public.production_orders.released_at IS 'Fecha de liberación';
COMMENT ON COLUMN public.production_orders.started_at IS 'Inicio real (primer consumo o primer proceso)';
COMMENT ON COLUMN public.production_orders.confirmed_by IS 'Usuario que confirmó lo fabricado';
COMMENT ON COLUMN public.production_orders.confirmed_at IS 'Fecha de confirmación';
COMMENT ON COLUMN public.production_orders.closed_by IS 'Usuario que cerró la orden';
COMMENT ON COLUMN public.production_orders.closed_at IS 'Fecha de cierre';
COMMENT ON COLUMN public.production_orders.cancelled_by IS 'Usuario que anuló la orden';
COMMENT ON COLUMN public.production_orders.cancelled_at IS 'Fecha de anulación';
COMMENT ON COLUMN public.production_orders.cancel_reason IS 'Motivo de la anulación';
COMMENT ON COLUMN public.production_orders.metadata IS 'Datos adicionales libres';
COMMENT ON COLUMN public.production_orders.created_by IS 'Usuario que la creó';
COMMENT ON COLUMN public.production_orders.updated_by IS 'Último usuario que la modificó';
COMMENT ON COLUMN public.production_orders.created_at IS 'Fecha de creación';
COMMENT ON COLUMN public.production_orders.updated_at IS 'Fecha de última modificación';
CREATE INDEX idx_production_orders_status ON public.production_orders (status);
CREATE INDEX idx_production_orders_product ON public.production_orders (product_id);

CREATE TABLE public.production_orders_details (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    production_order_id UUID NOT NULL REFERENCES public.production_orders(id) ON DELETE CASCADE,
    line_no INTEGER NOT NULL CHECK (line_no > 0),
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
    formula_detail_id UUID REFERENCES public.formulas_details(id) ON DELETE SET NULL,
    warehouse_id UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
    stage_id UUID REFERENCES public.stages(id) ON DELETE RESTRICT,
    quantity_required NUMERIC(18, 6) NOT NULL CHECK (quantity_required > 0),
    quantity_consumed NUMERIC(18, 6) NOT NULL DEFAULT 0 CHECK (quantity_consumed >= 0),
    is_critical BOOLEAN NOT NULL DEFAULT FALSE,
    std_unit_cost NUMERIC(18, 6) NOT NULL DEFAULT 0,
    consumed_cost NUMERIC(22, 6) NOT NULL DEFAULT 0,
    notes VARCHAR(400),
    CONSTRAINT uq_production_orders_details_line UNIQUE (production_order_id, line_no)
);
COMMENT ON TABLE public.production_orders_details IS 'Materiales de la orden (tesis: Detalle de la Orden de Producción): explosión de un nivel de la fórmula';
COMMENT ON COLUMN public.production_orders_details.id IS 'Identificador único';
COMMENT ON COLUMN public.production_orders_details.production_order_id IS 'Orden de producción';
COMMENT ON COLUMN public.production_orders_details.line_no IS 'Nº de línea';
COMMENT ON COLUMN public.production_orders_details.product_id IS 'Componente';
COMMENT ON COLUMN public.production_orders_details.formula_detail_id IS 'Línea de la fórmula de la que salió';
COMMENT ON COLUMN public.production_orders_details.warehouse_id IS 'Almacén del que se consume';
COMMENT ON COLUMN public.production_orders_details.stage_id IS 'Etapa en que se consume';
COMMENT ON COLUMN public.production_orders_details.quantity_required IS 'Cantidad requerida (con merma) en unidad de almacén';
COMMENT ON COLUMN public.production_orders_details.quantity_consumed IS 'Cantidad consumida (salidas CONS_PROD netas)';
COMMENT ON COLUMN public.production_orders_details.is_critical IS 'Crítico: su falta impide liberar la orden';
COMMENT ON COLUMN public.production_orders_details.std_unit_cost IS 'Costo unitario estándar al crear/liberar';
COMMENT ON COLUMN public.production_orders_details.consumed_cost IS 'Costo real de lo consumido';
COMMENT ON COLUMN public.production_orders_details.notes IS 'Observaciones';

CREATE TABLE public.production_processes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    production_order_id UUID NOT NULL REFERENCES public.production_orders(id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL CHECK (sequence > 0),
    stage_id UUID NOT NULL REFERENCES public.stages(id) ON DELETE RESTRICT,
    work_center_id UUID NOT NULL REFERENCES public.work_centers(id) ON DELETE RESTRICT,
    std_hours NUMERIC(12, 4) NOT NULL DEFAULT 0,
    status VARCHAR(12) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_process', 'done')),
    started_at TIMESTAMPTZ,
    started_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    finished_at TIMESTAMPTZ,
    finished_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    real_hours NUMERIC(12, 4) CHECK (real_hours >= 0),
    quantity_good NUMERIC(18, 6) CHECK (quantity_good >= 0),
    quantity_scrap NUMERIC(18, 6) CHECK (quantity_scrap >= 0),
    labor_rate NUMERIC(18, 4) NOT NULL DEFAULT 0,
    overhead_rate NUMERIC(18, 4) NOT NULL DEFAULT 0,
    notes VARCHAR(800),
    CONSTRAINT uq_production_processes_seq UNIQUE (production_order_id, sequence)
);
COMMENT ON TABLE public.production_processes IS 'Procesos de la orden (tesis: Clase Procesos): avance y tiempos reales por etapa';
COMMENT ON COLUMN public.production_processes.id IS 'Identificador único';
COMMENT ON COLUMN public.production_processes.production_order_id IS 'Orden de producción';
COMMENT ON COLUMN public.production_processes.sequence IS 'Secuencia (de la ruta)';
COMMENT ON COLUMN public.production_processes.stage_id IS 'Etapa';
COMMENT ON COLUMN public.production_processes.work_center_id IS 'Centro de trabajo';
COMMENT ON COLUMN public.production_processes.std_hours IS 'Horas teóricas: preparación + ejecución escalada a la cantidad';
COMMENT ON COLUMN public.production_processes.status IS 'pending, in_process o done';
COMMENT ON COLUMN public.production_processes.started_at IS 'Hora de Inicio';
COMMENT ON COLUMN public.production_processes.started_by IS 'Usuario que inició la etapa';
COMMENT ON COLUMN public.production_processes.finished_at IS 'Hora de Fin';
COMMENT ON COLUMN public.production_processes.finished_by IS 'Usuario que terminó la etapa';
COMMENT ON COLUMN public.production_processes.real_hours IS 'Horas reales trabajadas';
COMMENT ON COLUMN public.production_processes.quantity_good IS 'Cantidad buena que salió de la etapa';
COMMENT ON COLUMN public.production_processes.quantity_scrap IS 'Merma de la etapa';
COMMENT ON COLUMN public.production_processes.labor_rate IS 'Tarifa de mano de obra del centro de trabajo (copiada al crear)';
COMMENT ON COLUMN public.production_processes.overhead_rate IS 'Tarifa de costo fabril del centro de trabajo (copiada al crear)';
COMMENT ON COLUMN public.production_processes.notes IS 'Observaciones del operador';

-- --------------------------------------------------------------- Lotes: origen de producción
ALTER TABLE public.lots
    ADD COLUMN production_order_id UUID REFERENCES public.production_orders(id) ON DELETE SET NULL;
COMMENT ON COLUMN public.lots.production_order_id IS 'Orden de producción que fabricó el lote';

-- --------------------------------------------------------------- Reservas (Asignadas)
CREATE TABLE public.stock_reservations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
    lot_id UUID REFERENCES public.lots(id) ON DELETE RESTRICT,
    quantity NUMERIC(18, 6) NOT NULL CHECK (quantity > 0),
    source_module VARCHAR(40) NOT NULL,
    source_document_id UUID NOT NULL,
    source_line_id UUID NOT NULL,
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_stock_reservations UNIQUE NULLS NOT DISTINCT (source_line_id, warehouse_id, lot_id)
);
COMMENT ON TABLE public.stock_reservations IS 'Reservas de existencia para un documento (tesis: Asignadas). Mantiene stock_balances.reserved';
COMMENT ON COLUMN public.stock_reservations.id IS 'Identificador único';
COMMENT ON COLUMN public.stock_reservations.warehouse_id IS 'Almacén';
COMMENT ON COLUMN public.stock_reservations.product_id IS 'Producto';
COMMENT ON COLUMN public.stock_reservations.lot_id IS 'Lote reservado (NULL si no maneja lote)';
COMMENT ON COLUMN public.stock_reservations.quantity IS 'Cantidad reservada (unidad de almacén)';
COMMENT ON COLUMN public.stock_reservations.source_module IS 'Módulo del documento (PRODUCTION, SALES)';
COMMENT ON COLUMN public.stock_reservations.source_document_id IS 'Documento que reserva';
COMMENT ON COLUMN public.stock_reservations.source_line_id IS 'Línea del documento que reserva';
COMMENT ON COLUMN public.stock_reservations.created_by IS 'Usuario que reservó';
COMMENT ON COLUMN public.stock_reservations.created_at IS 'Fecha de la reserva';
CREATE INDEX idx_stock_reservations_doc ON public.stock_reservations (source_document_id);

CREATE OR REPLACE FUNCTION public.fn_stock_reservations_sync()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_delta NUMERIC;
    v_q NUMERIC;
    v_r NUMERIC;
    v_label TEXT;
    l public.lots%ROWTYPE;
BEGIN
    IF TG_OP = 'UPDATE' AND (NEW.warehouse_id, NEW.product_id, NEW.lot_id) IS DISTINCT FROM (OLD.warehouse_id, OLD.product_id, OLD.lot_id) THEN
        RAISE EXCEPTION 'Una reserva no cambia de almacén, producto ni lote' USING ERRCODE = 'P0001';
    END IF;

    IF TG_OP = 'DELETE' THEN
        UPDATE public.stock_balances SET reserved = GREATEST(reserved - OLD.quantity, 0), updated_at = NOW()
         WHERE warehouse_id = OLD.warehouse_id AND product_id = OLD.product_id AND lot_id IS NOT DISTINCT FROM OLD.lot_id;
        RETURN OLD;
    END IF;

    v_delta := NEW.quantity - CASE WHEN TG_OP = 'UPDATE' THEN OLD.quantity ELSE 0 END;

    SELECT quantity, reserved INTO v_q, v_r
      FROM public.stock_balances
     WHERE warehouse_id = NEW.warehouse_id AND product_id = NEW.product_id AND lot_id IS NOT DISTINCT FROM NEW.lot_id
       FOR UPDATE;

    IF v_delta > 0 THEN
        SELECT code INTO v_label FROM public.products WHERE id = NEW.product_id;
        IF NEW.lot_id IS NOT NULL THEN
            SELECT * INTO l FROM public.lots WHERE id = NEW.lot_id;
            v_label := v_label || ' lote ' || l.lot_code;
            IF l.quality_status <> 'approved' THEN
                RAISE EXCEPTION 'No se reserva el lote % de %: no está liberado por Calidad', l.lot_code, v_label USING ERRCODE = 'P0001';
            END IF;
            IF l.expires_on IS NOT NULL AND l.expires_on < CURRENT_DATE THEN
                RAISE EXCEPTION 'No se reserva el lote %: está vencido', l.lot_code USING ERRCODE = 'P0001';
            END IF;
        END IF;
        IF v_q IS NULL OR v_q - v_r < v_delta THEN
            RAISE EXCEPTION 'Existencia insuficiente para reservar %: disponible %, solicitado %',
                v_label, trim_scale(round(COALESCE(v_q - v_r, 0), 6)), trim_scale(round(v_delta, 6)) USING ERRCODE = 'P0001';
        END IF;
    END IF;

    IF v_q IS NOT NULL THEN
        UPDATE public.stock_balances SET reserved = GREATEST(reserved + v_delta, 0), updated_at = NOW()
         WHERE warehouse_id = NEW.warehouse_id AND product_id = NEW.product_id AND lot_id IS NOT DISTINCT FROM NEW.lot_id;
    END IF;
    RETURN NEW;
END;
$$;
COMMENT ON FUNCTION public.fn_stock_reservations_sync() IS 'Mantiene stock_balances.reserved al reservar, ajustar o liberar; valida disponible, calidad y vencimiento';

CREATE TRIGGER trg_stock_reservations_sync BEFORE INSERT OR UPDATE OR DELETE ON public.stock_reservations
    FOR EACH ROW EXECUTE FUNCTION public.fn_stock_reservations_sync();

-- --------------------------------------------------------------- Disponible por lote
-- Lo que se puede reservar o consumir: existencia − reservado, solo lotes aprobados y vigentes.
CREATE VIEW public.v_stock_available AS
SELECT b.warehouse_id, b.product_id, b.lot_id, l.lot_code, l.expires_on,
       b.quantity, b.reserved, b.quantity - b.reserved AS available
  FROM public.stock_balances b
  LEFT JOIN public.lots l ON l.id = b.lot_id
 WHERE b.quantity - b.reserved > 0
   AND (b.lot_id IS NULL OR (l.quality_status = 'approved' AND (l.expires_on IS NULL OR l.expires_on >= CURRENT_DATE)));
COMMENT ON VIEW public.v_stock_available IS 'Existencia disponible (no reservada) en lotes aprobados y no vencidos, por almacén/producto/lote';

-- --------------------------------------------------------------- Triggers comunes
DO $$
DECLARE
    t TEXT;
BEGIN
    EXECUTE 'CREATE TRIGGER trg_production_orders_updated_at BEFORE UPDATE ON public.production_orders
             FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at()';
    FOREACH t IN ARRAY ARRAY['production_orders', 'production_orders_details', 'production_processes', 'stock_reservations'] LOOP
        EXECUTE format('CREATE TRIGGER trg_audit_%1$s AFTER INSERT OR UPDATE OR DELETE ON public.%1$I
                        FOR EACH ROW EXECUTE FUNCTION public.fn_audit()', t);
    END LOOP;
END
$$;

-- Una orden con historia no se borra: se anula (el API solo borra las creadas sin movimientos).
REVOKE TRUNCATE ON public.production_orders, public.production_orders_details, public.production_processes, public.stock_reservations FROM :"app_user";

-- --------------------------------------------------------------- Inventario del semielaborado
-- 30 kg de granulado aprobados: permiten fabricar tabletas sin pasar antes por la granulación.
DO $$
DECLARE
    v_mov UUID;
    v_lot UUID;
BEGIN
    INSERT INTO public.inventory_movements (number, movement_date, concept_id, direction, warehouse_id, reference, notes)
    SELECT public.fn_next_document_number('MOV'), CURRENT_DATE - 20, c.id, 'in', w.id, 'DEMO', 'Inventario inicial del semielaborado'
      FROM public.catalogs_movement_concepts c, public.warehouses w WHERE c.code = 'INV_INI' AND w.code = 'MP'
    RETURNING id INTO v_mov;

    INSERT INTO public.lots (product_id, lot_code, manufactured_on, expires_on, received_on, quality_status, unit_cost, origin_movement_id)
    SELECT id, 'GP-2601', CURRENT_DATE - 20, CURRENT_DATE + 160, CURRENT_DATE - 20, 'approved', 12.20, v_mov
      FROM public.products WHERE code = 'SE-GRAN-PARA'
    RETURNING id INTO v_lot;

    INSERT INTO public.inventory_movements_details (movement_id, line_no, product_id, lot_id, quantity, unit_cost)
    SELECT v_mov, 1, id, v_lot, 30, 12.20 FROM public.products WHERE code = 'SE-GRAN-PARA';

    PERFORM public.fn_post_inventory_movement(v_mov);
END
$$;

-- --------------------------------------------------------------- Activar la fase 5
UPDATE public.catalogs_modules SET is_offline = FALSE
 WHERE code IN ('PRODUCTION', 'PRD_STAGES', 'PRD_ROUTES', 'PRD_FORMULAS', 'PRD_CENTERS', 'PRD_ORDERS', 'PRD_TRACKING');
