-- =====================================================================
--  FabriHub · 20261004_0701_planning.sql   (fase 7 · Planificación)
--  Tesis 4.2.2.1.2: Período, Planificación (plan de ventas y plan maestro)
--  y el método Planificación.Calcular (MRP).
--
--  Corrección a la tesis: las columnas Enero…Diciembre pasan a filas
--  plans(period_id, product_id, plan_type, month, quantity).
--
--  Flujo:  plan de ventas ──generar──▶ plan maestro (MPS, editable)
--          MPS ──correr MRP──▶ mrp_results (tabla MRP por producto y mes)
--                         └──▶ mrp_suggestions (fabricar → OP planificada · comprar → OC en borrador)
-- =====================================================================

-- --------------------------------------------------------------- Tiempos de entrega
ALTER TABLE public.products
    ADD COLUMN lead_time_days INTEGER NOT NULL DEFAULT 0 CHECK (lead_time_days BETWEEN 0 AND 365);
COMMENT ON COLUMN public.products.lead_time_days IS 'Tiempo de reposición (días): entrega del proveedor o fabricación. El MRP adelanta la orden en este plazo';

UPDATE public.products p SET lead_time_days = CASE t.code WHEN 'MP' THEN 21 WHEN 'ME' THEN 14 WHEN 'SE' THEN 3 WHEN 'PT' THEN 7 ELSE 0 END
  FROM public.catalogs_product_types t WHERE t.id = p.product_type_id;

-- --------------------------------------------------------------- Fórmulas de los demás terminados
-- Para que el MRP pueda explotar todo el plan de ventas, Ibuprofeno y Vitamina C también llevan fórmula.
INSERT INTO public.products
    (code, name, product_type_id, family_id, category_id, stock_unit_id, purchase_unit_id, purchase_factor, is_stockable,
     is_lot_controlled, is_purchased, shelf_life_days, purchase_price, lead_time_days)
SELECT s.code, s.name, pt.id, pf.id, pc.id, su.id, pu.id, s.factor, TRUE, s.lot, TRUE, s.shelf, s.price, s.lead
FROM (VALUES
    ('MP-ACIDO-ASC',  'Ácido ascórbico (vitamina C) polvo USP', 'MP', 'KG',  'KG',     1,    TRUE,  730, 14.00, 30),
    ('ME-CAJA-IBU10', 'Caja plegadiza Ibuprofeno x 10',         'ME', 'UND', 'MILLAR', 1000, FALSE, NULL, 45.00, 14),
    ('ME-FRASCO-30',  'Frasco PEAD 30 tabletas con tapa',       'ME', 'UND', 'MILLAR', 1000, FALSE, NULL, 120.00, 21)
) AS s(code, name, type_code, stock_unit, purchase_unit, factor, lot, shelf, price, lead)
JOIN public.catalogs_product_types pt ON pt.code = s.type_code
JOIN public.catalogs_product_families pf ON pf.code = 'INSUMO'
JOIN public.catalogs_product_categories pc ON pc.code = 'INSUMOS'
JOIN public.catalogs_units su ON su.code = s.stock_unit
JOIN public.catalogs_units pu ON pu.code = s.purchase_unit;

INSERT INTO public.formulas (code, name, product_id, version, is_default, base_quantity, route_id, valid_from)
SELECT s.code, s.name, p.id, 1, TRUE, 1000, r.id, CURRENT_DATE - 30
  FROM (VALUES ('F-IBU400-1',  'Ibuprofeno 400 mg x 10 v1', 'PT-IBU400-10'),
               ('F-VITC500-1', 'Vitamina C 500 mg x 30 v1', 'PT-VITC500-30')) AS s(code, name, product)
  JOIN public.products p ON p.code = s.product
  JOIN public.routes r ON r.code = 'R-TABLETAS';

-- 1 caja IBU = 10 tabletas de 400 mg (4 g) · 1 frasco VITC = 30 tabletas de 500 mg (15 g)
INSERT INTO public.formulas_details (formula_id, line_no, component_id, quantity, scrap_pct, is_critical, stage_id)
SELECT f.id, s.line, p.id, s.qty, s.scrap, s.critical, st.id
FROM (VALUES
    ('F-IBU400-1',  1, 'MP-IBUPROFENO',  4.0,    1.0, TRUE,  'COMPRESION'),
    ('F-IBU400-1',  2, 'MP-ALMIDON',     1.5,    1.0, FALSE, 'COMPRESION'),
    ('F-IBU400-1',  3, 'MP-ESTEARATO',   0.05,   0.0, FALSE, 'COMPRESION'),
    ('F-IBU400-1',  4, 'ME-BLISTER',     1000.0, 2.0, FALSE, 'ACONDIC'),
    ('F-IBU400-1',  5, 'ME-CAJA-IBU10',  1000.0, 1.0, FALSE, 'ACONDIC'),
    ('F-VITC500-1', 1, 'MP-ACIDO-ASC',   15.0,   1.0, TRUE,  'COMPRESION'),
    ('F-VITC500-1', 2, 'MP-ALMIDON',     2.0,    1.0, FALSE, 'COMPRESION'),
    ('F-VITC500-1', 3, 'MP-ESTEARATO',   0.1,    0.0, FALSE, 'COMPRESION'),
    ('F-VITC500-1', 4, 'ME-FRASCO-30',   1000.0, 1.0, FALSE, 'ACONDIC')
) AS s(formula, line, product, qty, scrap, critical, stage)
JOIN public.formulas f ON f.code = s.formula
JOIN public.products p ON p.code = s.product
JOIN public.stages st ON st.code = s.stage;

-- Los nuevos insumos entran a las listas de sus proveedores (el MRP sugiere el proveedor desde aquí)
INSERT INTO public.price_lists_items (price_list_id, product_id, price)
SELECT l.id, p.id, s.price
  FROM (VALUES ('QUIMIVEN-26', 'MP-ACIDO-ASC', 14.80),
               ('EMPAQUES-26', 'ME-CAJA-IBU10', 46.00),
               ('EMPAQUES-26', 'ME-FRASCO-30', 118.00)) AS s(list, product, price)
  JOIN public.price_lists l ON l.code = s.list
  JOIN public.products p ON p.code = s.product;

-- --------------------------------------------------------------- Períodos
CREATE TABLE public.planning_periods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(20) NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9_-]+$'),
    name VARCHAR(120) NOT NULL,
    year SMALLINT NOT NULL CHECK (year BETWEEN 2000 AND 2100),
    status VARCHAR(10) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    notes VARCHAR(800),
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE public.planning_periods IS 'Períodos de planificación (tesis: Clase Período): un año de planes mensuales';
COMMENT ON COLUMN public.planning_periods.id IS 'Identificador único';
COMMENT ON COLUMN public.planning_periods.code IS 'Código del Período';
COMMENT ON COLUMN public.planning_periods.name IS 'Descripción';
COMMENT ON COLUMN public.planning_periods.year IS 'Año que planifica';
COMMENT ON COLUMN public.planning_periods.status IS 'open (se planifica) o closed (solo consulta)';
COMMENT ON COLUMN public.planning_periods.notes IS 'Observaciones';
COMMENT ON COLUMN public.planning_periods.created_by IS 'Usuario que lo creó';
COMMENT ON COLUMN public.planning_periods.updated_by IS 'Último usuario que lo modificó';
COMMENT ON COLUMN public.planning_periods.created_at IS 'Fecha de creación';
COMMENT ON COLUMN public.planning_periods.updated_at IS 'Fecha de última modificación';

-- --------------------------------------------------------------- Planes (ventas y maestro)
CREATE TABLE public.plans (
    period_id UUID NOT NULL REFERENCES public.planning_periods(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
    plan_type VARCHAR(6) NOT NULL CHECK (plan_type IN ('sales', 'mps')),
    month SMALLINT NOT NULL CHECK (month BETWEEN 1 AND 12),
    quantity NUMERIC(18, 6) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (period_id, product_id, plan_type, month)
);
COMMENT ON TABLE public.plans IS 'Planificación mensual (tesis: Enero…Diciembre normalizado a filas): plan de ventas y plan maestro de producción';
COMMENT ON COLUMN public.plans.period_id IS 'Período';
COMMENT ON COLUMN public.plans.product_id IS 'Producto';
COMMENT ON COLUMN public.plans.plan_type IS 'sales (plan de ventas) o mps (plan maestro de producción)';
COMMENT ON COLUMN public.plans.month IS 'Mes (1 = enero)';
COMMENT ON COLUMN public.plans.quantity IS 'Cantidad en unidad de almacén';
COMMENT ON COLUMN public.plans.updated_by IS 'Último usuario que la cambió';
COMMENT ON COLUMN public.plans.updated_at IS 'Fecha del último cambio';

-- --------------------------------------------------------------- Corridas del MRP
CREATE TABLE public.mrp_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    period_id UUID NOT NULL REFERENCES public.planning_periods(id) ON DELETE CASCADE,
    first_month SMALLINT NOT NULL CHECK (first_month BETWEEN 1 AND 12),
    months SMALLINT NOT NULL CHECK (months BETWEEN 1 AND 12),
    products INTEGER NOT NULL DEFAULT 0,
    suggestions INTEGER NOT NULL DEFAULT 0,
    params JSONB NOT NULL DEFAULT '{}',
    run_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    run_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE public.mrp_runs IS 'Corridas del MRP (tesis: método Planificación.Calcular). Se conserva la foto de cada corrida';
COMMENT ON COLUMN public.mrp_runs.id IS 'Identificador único';
COMMENT ON COLUMN public.mrp_runs.period_id IS 'Período planificado';
COMMENT ON COLUMN public.mrp_runs.first_month IS 'Primer mes del horizonte';
COMMENT ON COLUMN public.mrp_runs.months IS 'Meses del horizonte (parámetro mrp_horizon_months)';
COMMENT ON COLUMN public.mrp_runs.products IS 'Productos calculados';
COMMENT ON COLUMN public.mrp_runs.suggestions IS 'Órdenes sugeridas';
COMMENT ON COLUMN public.mrp_runs.params IS 'Supuestos de la corrida (existencias consideradas, recepciones programadas)';
COMMENT ON COLUMN public.mrp_runs.run_by IS 'Usuario que corrió el MRP';
COMMENT ON COLUMN public.mrp_runs.run_at IS 'Fecha y hora de la corrida';

CREATE TABLE public.mrp_results (
    run_id UUID NOT NULL REFERENCES public.mrp_runs(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    low_level SMALLINT NOT NULL DEFAULT 0,
    month SMALLINT NOT NULL CHECK (month BETWEEN 1 AND 12),
    gross NUMERIC(18, 6) NOT NULL DEFAULT 0,
    scheduled NUMERIC(18, 6) NOT NULL DEFAULT 0,
    projected NUMERIC(18, 6) NOT NULL DEFAULT 0,
    net NUMERIC(18, 6) NOT NULL DEFAULT 0,
    planned_receipt NUMERIC(18, 6) NOT NULL DEFAULT 0,
    planned_release NUMERIC(18, 6) NOT NULL DEFAULT 0,
    PRIMARY KEY (run_id, product_id, month)
);
COMMENT ON TABLE public.mrp_results IS 'Tabla MRP por producto y mes: necesidades brutas, recepciones programadas, disponible proyectado, netas y órdenes planificadas';
COMMENT ON COLUMN public.mrp_results.run_id IS 'Corrida';
COMMENT ON COLUMN public.mrp_results.product_id IS 'Producto';
COMMENT ON COLUMN public.mrp_results.low_level IS 'Nivel más bajo en que aparece el producto en las fórmulas (0 = terminado)';
COMMENT ON COLUMN public.mrp_results.month IS 'Mes';
COMMENT ON COLUMN public.mrp_results.gross IS 'Necesidades brutas (MPS o demanda dependiente de la explosión)';
COMMENT ON COLUMN public.mrp_results.scheduled IS 'Recepciones programadas: OC y OP abiertas que llegan en el mes';
COMMENT ON COLUMN public.mrp_results.projected IS 'Disponible proyectado al cierre del mes';
COMMENT ON COLUMN public.mrp_results.net IS 'Necesidades netas';
COMMENT ON COLUMN public.mrp_results.planned_receipt IS 'Recepción de orden planificada (con tamaño de lote)';
COMMENT ON COLUMN public.mrp_results.planned_release IS 'Lanzamiento de orden planificada (adelantado por el tiempo de reposición)';

CREATE TABLE public.mrp_suggestions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID NOT NULL REFERENCES public.mrp_runs(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    kind VARCHAR(4) NOT NULL CHECK (kind IN ('make', 'buy')),
    quantity NUMERIC(18, 6) NOT NULL CHECK (quantity > 0),
    net_quantity NUMERIC(18, 6) NOT NULL,
    release_date DATE NOT NULL,
    due_date DATE NOT NULL,
    is_late BOOLEAN NOT NULL DEFAULT FALSE,
    supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
    warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE SET NULL,
    status VARCHAR(10) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'converted', 'dismissed')),
    document_module VARCHAR(20),
    document_id UUID,
    document_number VARCHAR(30),
    decided_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    decided_at TIMESTAMPTZ
);
COMMENT ON TABLE public.mrp_suggestions IS 'Órdenes sugeridas por el MRP: fabricar (OP) o comprar (OC)';
COMMENT ON COLUMN public.mrp_suggestions.id IS 'Identificador único';
COMMENT ON COLUMN public.mrp_suggestions.run_id IS 'Corrida que la generó';
COMMENT ON COLUMN public.mrp_suggestions.product_id IS 'Producto';
COMMENT ON COLUMN public.mrp_suggestions.kind IS 'make (orden de producción) o buy (orden de compra)';
COMMENT ON COLUMN public.mrp_suggestions.quantity IS 'Cantidad sugerida con tamaño de lote (unidad de almacén)';
COMMENT ON COLUMN public.mrp_suggestions.net_quantity IS 'Necesidad neta que la origina';
COMMENT ON COLUMN public.mrp_suggestions.release_date IS 'Fecha en que debe emitirse la orden';
COMMENT ON COLUMN public.mrp_suggestions.due_date IS 'Fecha en que se necesita';
COMMENT ON COLUMN public.mrp_suggestions.is_late IS 'La fecha de emisión ya pasó: la orden llega tarde si no se agiliza';
COMMENT ON COLUMN public.mrp_suggestions.supplier_id IS 'Proveedor sugerido (lista de precios o última compra)';
COMMENT ON COLUMN public.mrp_suggestions.warehouse_id IS 'Almacén donde se recibe';
COMMENT ON COLUMN public.mrp_suggestions.status IS 'open, converted (se generó el documento) o dismissed (descartada)';
COMMENT ON COLUMN public.mrp_suggestions.document_module IS 'PRODUCTION o PURCHASES';
COMMENT ON COLUMN public.mrp_suggestions.document_id IS 'Orden generada';
COMMENT ON COLUMN public.mrp_suggestions.document_number IS 'Número de la orden generada';
COMMENT ON COLUMN public.mrp_suggestions.decided_by IS 'Usuario que la convirtió o descartó';
COMMENT ON COLUMN public.mrp_suggestions.decided_at IS 'Fecha de la decisión';
CREATE INDEX idx_mrp_suggestions_run ON public.mrp_suggestions (run_id, status);

-- --------------------------------------------------------------- Triggers
CREATE TRIGGER trg_planning_periods_updated_at BEFORE UPDATE ON public.planning_periods
    FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();
DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['planning_periods', 'mrp_runs', 'mrp_suggestions'] LOOP
        EXECUTE format('CREATE TRIGGER trg_audit_%1$s AFTER INSERT OR UPDATE OR DELETE ON public.%1$I
                        FOR EACH ROW EXECUTE FUNCTION public.fn_audit()', t);
    END LOOP;
END
$$;

-- --------------------------------------------------------------- Demostración: plan del año en curso
INSERT INTO public.planning_periods (code, name, year, notes)
SELECT 'P' || EXTRACT(YEAR FROM CURRENT_DATE)::int, 'Plan ' || EXTRACT(YEAR FROM CURRENT_DATE)::int, EXTRACT(YEAR FROM CURRENT_DATE)::int,
       'Plan de demostración del caso COFASA';

-- Plan de ventas: paracetamol con estacionalidad (sube en temporada de lluvias), vitamina C estable
INSERT INTO public.plans (period_id, product_id, plan_type, month, quantity)
SELECT pp.id, p.id, 'sales', m.month,
       CASE p.code
         WHEN 'PT-PARA500-20' THEN (ARRAY[900, 900, 1000, 1100, 1400, 1600, 1700, 1600, 1400, 1500, 1800, 2000])[m.month]
         WHEN 'PT-IBU400-10'  THEN (ARRAY[600, 600, 650, 700, 750, 800, 800, 750, 700, 750, 800, 900])[m.month]
         ELSE                      (ARRAY[300, 300, 300, 300, 350, 350, 350, 350, 400, 400, 450, 500])[m.month]
       END
  FROM public.planning_periods pp
 CROSS JOIN public.products p
 CROSS JOIN generate_series(1, 12) AS m(month)
 WHERE p.code IN ('PT-PARA500-20', 'PT-IBU400-10', 'PT-VITC500-30');

-- --------------------------------------------------------------- Activar la fase 7
UPDATE public.catalogs_modules SET is_offline = FALSE WHERE code = 'PRD_PLANNING';
