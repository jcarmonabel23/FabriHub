-- =====================================================================
--  FabriHub · 20261004_0501_production_masters.sql   (fase 5 · Producción)
--  Tesis 4.2.2.1.2 (Planificación y Control de la Producción): Etapas,
--  Rutas (con sus tiempos teóricos), Centros de Producción, Centros de
--  Trabajo y Fórmulas, con los métodos Load Explosión / Load Implosión.
--
--  Correcciones al diseño de la tesis:
--    · Una fórmula tiene N componentes (formulas_details) y UNA ruta.
--    · Un centro de trabajo pertenece a un centro de producción (FK directa en vez de la
--      tabla puente production_centers_work_centers: en el caso no se comparten máquinas).
--    · Los tiempos teóricos de la ruta son por "cantidad base": preparación fija + ejecución
--      proporcional, así se escalan a cualquier tamaño de lote.
-- =====================================================================

-- --------------------------------------------------------------- Etapas
CREATE TABLE public.stages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    order_list INTEGER NOT NULL DEFAULT 0,
    code VARCHAR(20) NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9_-]+$'),
    name VARCHAR(120) NOT NULL,
    description VARCHAR(400),
    metadata JSONB NOT NULL DEFAULT '{}',
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE public.stages IS 'Etapas del proceso productivo (tesis: Clase Etapas)';
COMMENT ON COLUMN public.stages.id IS 'Identificador único';
COMMENT ON COLUMN public.stages.is_active IS 'Activa: disponible para rutas nuevas';
COMMENT ON COLUMN public.stages.order_list IS 'Orden de presentación';
COMMENT ON COLUMN public.stages.code IS 'Código de Etapa';
COMMENT ON COLUMN public.stages.name IS 'Descripción de la etapa';
COMMENT ON COLUMN public.stages.description IS 'Detalle de la etapa';
COMMENT ON COLUMN public.stages.metadata IS 'Datos adicionales libres';
COMMENT ON COLUMN public.stages.created_by IS 'Usuario que la creó';
COMMENT ON COLUMN public.stages.updated_by IS 'Último usuario que la modificó';
COMMENT ON COLUMN public.stages.created_at IS 'Fecha de creación';
COMMENT ON COLUMN public.stages.updated_at IS 'Fecha de última modificación';

-- --------------------------------------------------------------- Tipos de centro de trabajo
CREATE TABLE public.catalogs_work_center_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    order_list INTEGER NOT NULL DEFAULT 0,
    code VARCHAR(20) NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9_-]+$'),
    name VARCHAR(120) NOT NULL,
    description VARCHAR(400),
    metadata JSONB NOT NULL DEFAULT '{}',
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE public.catalogs_work_center_types IS 'Tipos de centro de trabajo (tesis: Tipo de Centro de Trabajo): máquina, manual, laboratorio';
COMMENT ON COLUMN public.catalogs_work_center_types.id IS 'Identificador único';
COMMENT ON COLUMN public.catalogs_work_center_types.is_active IS 'Activo';
COMMENT ON COLUMN public.catalogs_work_center_types.order_list IS 'Orden de presentación';
COMMENT ON COLUMN public.catalogs_work_center_types.code IS 'Código del tipo';
COMMENT ON COLUMN public.catalogs_work_center_types.name IS 'Nombre';
COMMENT ON COLUMN public.catalogs_work_center_types.description IS 'Descripción';
COMMENT ON COLUMN public.catalogs_work_center_types.metadata IS 'Datos adicionales libres';
COMMENT ON COLUMN public.catalogs_work_center_types.created_by IS 'Usuario que lo creó';
COMMENT ON COLUMN public.catalogs_work_center_types.updated_by IS 'Último usuario que lo modificó';
COMMENT ON COLUMN public.catalogs_work_center_types.created_at IS 'Fecha de creación';
COMMENT ON COLUMN public.catalogs_work_center_types.updated_at IS 'Fecha de última modificación';

-- --------------------------------------------------------------- Centros de producción
CREATE TABLE public.production_centers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    order_list INTEGER NOT NULL DEFAULT 0,
    code VARCHAR(20) NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9_-]+$'),
    name VARCHAR(120) NOT NULL,
    description VARCHAR(400),
    materials_warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE RESTRICT,
    output_warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE RESTRICT,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE public.production_centers IS 'Centros de producción (tesis: Clase Centros de Producción): área de planta que fabrica';
COMMENT ON COLUMN public.production_centers.id IS 'Identificador único';
COMMENT ON COLUMN public.production_centers.is_active IS 'Activo';
COMMENT ON COLUMN public.production_centers.order_list IS 'Orden de presentación';
COMMENT ON COLUMN public.production_centers.code IS 'Código del Centro de Producción';
COMMENT ON COLUMN public.production_centers.name IS 'Descripción del centro';
COMMENT ON COLUMN public.production_centers.description IS 'Detalle';
COMMENT ON COLUMN public.production_centers.materials_warehouse_id IS 'Almacén sugerido para consumir materiales (si no se indica, el de mayor disponible)';
COMMENT ON COLUMN public.production_centers.output_warehouse_id IS 'Almacén sugerido para el producto fabricado';
COMMENT ON COLUMN public.production_centers.metadata IS 'Datos adicionales libres';
COMMENT ON COLUMN public.production_centers.created_by IS 'Usuario que lo creó';
COMMENT ON COLUMN public.production_centers.updated_by IS 'Último usuario que lo modificó';
COMMENT ON COLUMN public.production_centers.created_at IS 'Fecha de creación';
COMMENT ON COLUMN public.production_centers.updated_at IS 'Fecha de última modificación';

CREATE TABLE public.production_centers_stages (
    production_center_id UUID NOT NULL REFERENCES public.production_centers(id) ON DELETE CASCADE,
    stage_id UUID NOT NULL REFERENCES public.stages(id) ON DELETE RESTRICT,
    PRIMARY KEY (production_center_id, stage_id)
);
COMMENT ON TABLE public.production_centers_stages IS 'Etapas que puede ejecutar cada centro de producción (tesis: Etapas por Centro de Producción)';
COMMENT ON COLUMN public.production_centers_stages.production_center_id IS 'Centro de producción';
COMMENT ON COLUMN public.production_centers_stages.stage_id IS 'Etapa';

-- --------------------------------------------------------------- Centros de trabajo
CREATE TABLE public.work_centers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    order_list INTEGER NOT NULL DEFAULT 0,
    code VARCHAR(20) NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9_-]+$'),
    name VARCHAR(120) NOT NULL,
    description VARCHAR(400),
    work_center_type_id UUID NOT NULL REFERENCES public.catalogs_work_center_types(id) ON DELETE RESTRICT,
    production_center_id UUID NOT NULL REFERENCES public.production_centers(id) ON DELETE RESTRICT,
    capacity_hours_day NUMERIC(6, 2) NOT NULL DEFAULT 8 CHECK (capacity_hours_day > 0 AND capacity_hours_day <= 24),
    efficiency_pct NUMERIC(6, 2) NOT NULL DEFAULT 100 CHECK (efficiency_pct > 0 AND efficiency_pct <= 200),
    labor_rate NUMERIC(18, 4) NOT NULL DEFAULT 0 CHECK (labor_rate >= 0),
    overhead_rate NUMERIC(18, 4) NOT NULL DEFAULT 0 CHECK (overhead_rate >= 0),
    metadata JSONB NOT NULL DEFAULT '{}',
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE public.work_centers IS 'Centros de trabajo (tesis: Clase Centros de Trabajo): máquina o puesto donde se ejecuta una etapa';
COMMENT ON COLUMN public.work_centers.id IS 'Identificador único';
COMMENT ON COLUMN public.work_centers.is_active IS 'Activo';
COMMENT ON COLUMN public.work_centers.order_list IS 'Orden de presentación';
COMMENT ON COLUMN public.work_centers.code IS 'Código del Centro de Trabajo';
COMMENT ON COLUMN public.work_centers.name IS 'Descripción';
COMMENT ON COLUMN public.work_centers.description IS 'Detalle';
COMMENT ON COLUMN public.work_centers.work_center_type_id IS 'Tipo de centro de trabajo';
COMMENT ON COLUMN public.work_centers.production_center_id IS 'Centro de producción al que pertenece';
COMMENT ON COLUMN public.work_centers.capacity_hours_day IS 'Capacidad disponible (horas por día)';
COMMENT ON COLUMN public.work_centers.efficiency_pct IS 'Eficiencia esperada (%)';
COMMENT ON COLUMN public.work_centers.labor_rate IS 'Costo de mano de obra por hora (moneda base)';
COMMENT ON COLUMN public.work_centers.overhead_rate IS 'Costo fabril (indirecto) por hora (moneda base)';
COMMENT ON COLUMN public.work_centers.metadata IS 'Datos adicionales libres';
COMMENT ON COLUMN public.work_centers.created_by IS 'Usuario que lo creó';
COMMENT ON COLUMN public.work_centers.updated_by IS 'Último usuario que lo modificó';
COMMENT ON COLUMN public.work_centers.created_at IS 'Fecha de creación';
COMMENT ON COLUMN public.work_centers.updated_at IS 'Fecha de última modificación';

-- --------------------------------------------------------------- Rutas
CREATE TABLE public.routes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    code VARCHAR(20) NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9_-]+$'),
    name VARCHAR(120) NOT NULL,
    description VARCHAR(400),
    production_center_id UUID REFERENCES public.production_centers(id) ON DELETE RESTRICT,
    base_quantity NUMERIC(18, 6) NOT NULL DEFAULT 1 CHECK (base_quantity > 0),
    metadata JSONB NOT NULL DEFAULT '{}',
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE public.routes IS 'Rutas de fabricación (tesis: Clase Rutas): secuencia de etapas con sus tiempos teóricos';
COMMENT ON COLUMN public.routes.id IS 'Identificador único';
COMMENT ON COLUMN public.routes.is_active IS 'Activa';
COMMENT ON COLUMN public.routes.code IS 'Código de Ruta';
COMMENT ON COLUMN public.routes.name IS 'Descripción de la ruta';
COMMENT ON COLUMN public.routes.description IS 'Detalle';
COMMENT ON COLUMN public.routes.production_center_id IS 'Centro de producción que la ejecuta';
COMMENT ON COLUMN public.routes.base_quantity IS 'Cantidad (en unidad del producto) a la que se refieren los tiempos de ejecución';
COMMENT ON COLUMN public.routes.metadata IS 'Datos adicionales libres';
COMMENT ON COLUMN public.routes.created_by IS 'Usuario que la creó';
COMMENT ON COLUMN public.routes.updated_by IS 'Último usuario que la modificó';
COMMENT ON COLUMN public.routes.created_at IS 'Fecha de creación';
COMMENT ON COLUMN public.routes.updated_at IS 'Fecha de última modificación';

CREATE TABLE public.routes_data (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    route_id UUID NOT NULL REFERENCES public.routes(id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL CHECK (sequence > 0),
    stage_id UUID NOT NULL REFERENCES public.stages(id) ON DELETE RESTRICT,
    work_center_id UUID NOT NULL REFERENCES public.work_centers(id) ON DELETE RESTRICT,
    setup_hours NUMERIC(10, 4) NOT NULL DEFAULT 0 CHECK (setup_hours >= 0),
    run_hours NUMERIC(10, 4) NOT NULL DEFAULT 0 CHECK (run_hours >= 0),
    notes VARCHAR(400),
    CONSTRAINT uq_routes_data_sequence UNIQUE (route_id, sequence)
);
COMMENT ON TABLE public.routes_data IS 'Datos de la ruta (tesis: Datos de Rutas): etapa, centro de trabajo y tiempos teóricos';
COMMENT ON COLUMN public.routes_data.id IS 'Identificador único';
COMMENT ON COLUMN public.routes_data.route_id IS 'Ruta';
COMMENT ON COLUMN public.routes_data.sequence IS 'Orden de la etapa en la ruta';
COMMENT ON COLUMN public.routes_data.stage_id IS 'Etapa';
COMMENT ON COLUMN public.routes_data.work_center_id IS 'Centro de trabajo donde se ejecuta';
COMMENT ON COLUMN public.routes_data.setup_hours IS 'Tiempo de preparación (horas, fijo por orden)';
COMMENT ON COLUMN public.routes_data.run_hours IS 'Tiempo de ejecución (horas) para la cantidad base de la ruta';
COMMENT ON COLUMN public.routes_data.notes IS 'Instrucciones';

-- --------------------------------------------------------------- Fórmulas (BOM)
CREATE TABLE public.formulas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    code VARCHAR(30) NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9._-]+$'),
    name VARCHAR(160) NOT NULL,
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    base_quantity NUMERIC(18, 6) NOT NULL DEFAULT 1 CHECK (base_quantity > 0),
    route_id UUID REFERENCES public.routes(id) ON DELETE RESTRICT,
    valid_from DATE NOT NULL DEFAULT CURRENT_DATE,
    notes VARCHAR(800),
    metadata JSONB NOT NULL DEFAULT '{}',
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_formulas_product_version UNIQUE (product_id, version)
);
COMMENT ON TABLE public.formulas IS 'Fórmulas / lista de materiales (tesis: Clase Fórmulas). Una fórmula tiene N componentes y una ruta';
COMMENT ON COLUMN public.formulas.id IS 'Identificador único';
COMMENT ON COLUMN public.formulas.is_active IS 'Activa: se puede usar en órdenes nuevas';
COMMENT ON COLUMN public.formulas.code IS 'Código de Fórmula';
COMMENT ON COLUMN public.formulas.name IS 'Descripción';
COMMENT ON COLUMN public.formulas.product_id IS 'Producto que fabrica';
COMMENT ON COLUMN public.formulas.version IS 'Versión de la fórmula del producto';
COMMENT ON COLUMN public.formulas.is_default IS 'Fórmula por defecto del producto (la usa la explosión y el MRP)';
COMMENT ON COLUMN public.formulas.base_quantity IS 'Cantidad del producto (unidad de almacén) que rinden las cantidades de los componentes';
COMMENT ON COLUMN public.formulas.route_id IS 'Ruta de fabricación';
COMMENT ON COLUMN public.formulas.valid_from IS 'Vigente desde';
COMMENT ON COLUMN public.formulas.notes IS 'Observaciones';
COMMENT ON COLUMN public.formulas.metadata IS 'Datos adicionales libres';
COMMENT ON COLUMN public.formulas.created_by IS 'Usuario que la creó';
COMMENT ON COLUMN public.formulas.updated_by IS 'Último usuario que la modificó';
COMMENT ON COLUMN public.formulas.created_at IS 'Fecha de creación';
COMMENT ON COLUMN public.formulas.updated_at IS 'Fecha de última modificación';
CREATE UNIQUE INDEX uq_formulas_default ON public.formulas (product_id) WHERE is_default;

CREATE TABLE public.formulas_details (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    formula_id UUID NOT NULL REFERENCES public.formulas(id) ON DELETE CASCADE,
    line_no INTEGER NOT NULL CHECK (line_no > 0),
    component_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
    quantity NUMERIC(18, 6) NOT NULL CHECK (quantity > 0),
    scrap_pct NUMERIC(6, 2) NOT NULL DEFAULT 0 CHECK (scrap_pct >= 0 AND scrap_pct < 100),
    is_critical BOOLEAN NOT NULL DEFAULT FALSE,
    stage_id UUID REFERENCES public.stages(id) ON DELETE RESTRICT,
    notes VARCHAR(400),
    CONSTRAINT uq_formulas_details_line UNIQUE (formula_id, line_no),
    CONSTRAINT uq_formulas_details_component UNIQUE (formula_id, component_id)
);
COMMENT ON TABLE public.formulas_details IS 'Componentes de la fórmula (tesis: Detalle de Fórmulas)';
COMMENT ON COLUMN public.formulas_details.id IS 'Identificador único';
COMMENT ON COLUMN public.formulas_details.formula_id IS 'Fórmula';
COMMENT ON COLUMN public.formulas_details.line_no IS 'Nº de línea';
COMMENT ON COLUMN public.formulas_details.component_id IS 'Producto componente (materia prima, empaque o semielaborado)';
COMMENT ON COLUMN public.formulas_details.quantity IS 'Cantidad neta del componente (su unidad de almacén) para la cantidad base';
COMMENT ON COLUMN public.formulas_details.scrap_pct IS 'Merma esperada (%): se agrega a la cantidad requerida';
COMMENT ON COLUMN public.formulas_details.is_critical IS 'Crítico: sin él no se puede liberar la orden';
COMMENT ON COLUMN public.formulas_details.stage_id IS 'Etapa de la ruta en que se consume';
COMMENT ON COLUMN public.formulas_details.notes IS 'Observaciones';

-- --------------------------------------------------------------- Triggers comunes
DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['stages', 'catalogs_work_center_types', 'production_centers', 'work_centers', 'routes', 'formulas'] LOOP
        EXECUTE format('CREATE TRIGGER trg_%1$s_updated_at BEFORE UPDATE ON public.%1$I
                        FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at()', t);
    END LOOP;
    FOREACH t IN ARRAY ARRAY['stages', 'catalogs_work_center_types', 'production_centers', 'production_centers_stages',
                             'work_centers', 'routes', 'routes_data', 'formulas', 'formulas_details'] LOOP
        EXECUTE format('CREATE TRIGGER trg_audit_%1$s AFTER INSERT OR UPDATE OR DELETE ON public.%1$I
                        FOR EACH ROW EXECUTE FUNCTION public.fn_audit()', t);
    END LOOP;
END
$$;

-- --------------------------------------------------------------- Explosión (Load Explosión)
-- Multinivel: los componentes fabricados (con fórmula por defecto activa) se abren a su vez.
-- Las cantidades incluyen la merma. Un ciclo (A usa B y B usa A) se detecta con la ruta del árbol.
CREATE OR REPLACE FUNCTION public.fn_bom_explode(p_product UUID, p_quantity NUMERIC, p_formula UUID DEFAULT NULL)
RETURNS TABLE (
    level INTEGER,
    path TEXT,
    parent_id UUID,
    component_id UUID,
    formula_id UUID,
    quantity NUMERIC,
    is_critical BOOLEAN,
    has_formula BOOLEAN
)
LANGUAGE plpgsql
STABLE
AS $$
#variable_conflict use_column
BEGIN
    IF p_formula IS NULL THEN
        SELECT f.id INTO p_formula FROM public.formulas f WHERE f.product_id = p_product AND f.is_default AND f.is_active;
        IF p_formula IS NULL THEN
            RAISE EXCEPTION 'El producto no tiene una fórmula por defecto activa' USING ERRCODE = 'P0001';
        END IF;
    END IF;

    RETURN QUERY
    WITH RECURSIVE tree AS (
        SELECT 1 AS lvl,
               lpad(d.line_no::text, 3, '0') AS pth,
               f.product_id AS par,
               d.component_id AS comp,
               f.id AS frm,
               p_quantity / f.base_quantity * d.quantity * (1 + d.scrap_pct / 100) AS qty,
               d.is_critical AS crit
          FROM public.formulas f
          JOIN public.formulas_details d ON d.formula_id = f.id
         WHERE f.id = p_formula
        UNION ALL
        SELECT t.lvl + 1,
               t.pth || '.' || lpad(d.line_no::text, 3, '0'),
               f.product_id,
               d.component_id,
               f.id,
               t.qty / f.base_quantity * d.quantity * (1 + d.scrap_pct / 100),
               d.is_critical
          FROM tree t
          JOIN public.formulas f ON f.product_id = t.comp AND f.is_default AND f.is_active
          JOIN public.formulas_details d ON d.formula_id = f.id
         WHERE t.lvl < 20
    ) CYCLE comp SET is_cycle USING cycle_path
    SELECT t.lvl, t.pth, t.par, t.comp, t.frm, round(t.qty, 6), t.crit,
           EXISTS (SELECT 1 FROM public.formulas f2 WHERE f2.product_id = t.comp AND f2.is_default AND f2.is_active)
      FROM tree t
     WHERE NOT t.is_cycle
     ORDER BY t.pth;
END;
$$;
COMMENT ON FUNCTION public.fn_bom_explode(UUID, NUMERIC, UUID) IS 'Explosión multinivel de la fórmula: componentes y cantidades (con merma) para fabricar p_quantity';

-- --------------------------------------------------------------- Implosión (Load Implosión)
-- Dónde se usa un componente, subiendo por todas las fórmulas activas.
CREATE OR REPLACE FUNCTION public.fn_bom_implode(p_component UUID)
RETURNS TABLE (
    level INTEGER,
    path TEXT,
    product_id UUID,
    formula_id UUID,
    used_component_id UUID,
    quantity NUMERIC,
    base_quantity NUMERIC
)
LANGUAGE sql
STABLE
AS $$
    WITH RECURSIVE up AS (
        SELECT 1 AS lvl, f.code::text AS pth, f.product_id AS prod, f.id AS frm, d.component_id AS used,
               d.quantity AS qty, f.base_quantity AS base
          FROM public.formulas_details d
          JOIN public.formulas f ON f.id = d.formula_id AND f.is_active
         WHERE d.component_id = p_component
        UNION ALL
        SELECT u.lvl + 1, u.pth || ' › ' || f.code, f.product_id, f.id, d.component_id, d.quantity, f.base_quantity
          FROM up u
          JOIN public.formulas_details d ON d.component_id = u.prod
          JOIN public.formulas f ON f.id = d.formula_id AND f.is_active
         WHERE u.lvl < 20
    ) CYCLE prod SET is_cycle USING cycle_path
    SELECT lvl, pth, prod, frm, used, qty, base FROM up WHERE NOT is_cycle ORDER BY pth;
$$;
COMMENT ON FUNCTION public.fn_bom_implode(UUID) IS 'Implosión: fórmulas (y productos) que usan el componente, en todos los niveles';

-- --------------------------------------------------------------- Ciclos e integridad de la fórmula
CREATE OR REPLACE FUNCTION public.fn_formulas_details_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_product UUID;
    v_code TEXT;
BEGIN
    SELECT product_id INTO v_product FROM public.formulas WHERE id = NEW.formula_id;
    IF NEW.component_id = v_product THEN
        RAISE EXCEPTION 'Un producto no puede ser componente de su propia fórmula' USING ERRCODE = 'P0001';
    END IF;
    IF NOT (SELECT is_stockable FROM public.products WHERE id = NEW.component_id) THEN
        RAISE EXCEPTION 'Los componentes de una fórmula deben ser inventariables' USING ERRCODE = 'P0001';
    END IF;
    -- ¿El componente (directa o indirectamente) ya usa el producto de esta fórmula? → ciclo
    SELECT p.code INTO v_code
      FROM public.fn_bom_implode(v_product) i JOIN public.products p ON p.id = i.product_id
     WHERE i.product_id = NEW.component_id LIMIT 1;
    IF v_code IS NOT NULL THEN
        RAISE EXCEPTION 'Ciclo en la fórmula: % ya usa este producto en su fórmula', v_code USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_formulas_details_guard BEFORE INSERT OR UPDATE OF component_id ON public.formulas_details
    FOR EACH ROW EXECUTE FUNCTION public.fn_formulas_details_guard();

-- --------------------------------------------------------------- Semillas
INSERT INTO public.stages (order_list, code, name, description) VALUES
    (1, 'PESADA',     'Pesada y dispensado',   'Pesar las materias primas según la fórmula'),
    (2, 'GRANULACION','Granulación',           'Mezcla húmeda, secado y tamizado'),
    (3, 'COMPRESION', 'Compresión',            'Tableteado del granulado'),
    (4, 'RECUBRIM',   'Recubrimiento',         'Recubrimiento de tabletas'),
    (5, 'ACONDIC',    'Acondicionamiento',     'Blisteado, estuchado y codificado'),
    (6, 'CONTROL',    'Control en proceso',    'Muestreo y verificación en línea');

INSERT INTO public.catalogs_work_center_types (order_list, code, name, description) VALUES
    (1, 'MAQUINA', 'Máquina', 'Equipo automático o semiautomático'),
    (2, 'MANUAL',  'Puesto manual', 'Operación manual'),
    (3, 'LAB',     'Laboratorio', 'Laboratorio de control en proceso');

INSERT INTO public.production_centers (order_list, code, name, description, materials_warehouse_id, output_warehouse_id)
SELECT 1, 'SOLIDOS', 'Sólidos orales', 'Tabletas y cápsulas',
       (SELECT id FROM public.warehouses WHERE code = 'MP'), (SELECT id FROM public.warehouses WHERE code = 'PT');

INSERT INTO public.production_centers_stages (production_center_id, stage_id)
SELECT c.id, s.id FROM public.production_centers c, public.stages s WHERE c.code = 'SOLIDOS';

INSERT INTO public.work_centers (order_list, code, name, work_center_type_id, production_center_id, capacity_hours_day, efficiency_pct, labor_rate, overhead_rate)
SELECT s.ord, s.code, s.name, t.id, c.id, s.cap, s.eff, s.labor, s.overhead
FROM (VALUES
    (1, 'BAL-01', 'Sala de pesada (balanzas)',      'MANUAL',  8.0,  100.0, 6.00,  4.00),
    (2, 'GRA-01', 'Granulador de alto corte',       'MAQUINA', 16.0,  90.0, 8.00, 18.00),
    (3, 'TAB-01', 'Tableteadora rotativa 27 punz.', 'MAQUINA', 16.0,  85.0, 8.00, 22.00),
    (4, 'BLI-01', 'Blisteadora termoformadora',     'MAQUINA', 16.0,  85.0, 10.00, 20.00),
    (5, 'LAB-IPC','Laboratorio de control en proceso','LAB',    8.0, 100.0, 9.00,  6.00)
) AS s(ord, code, name, type_code, cap, eff, labor, overhead)
JOIN public.catalogs_work_center_types t ON t.code = s.type_code
CROSS JOIN public.production_centers c
WHERE c.code = 'SOLIDOS';

-- Semielaborado para tener una fórmula de dos niveles (Paracetamol → granulado → tabletas)
INSERT INTO public.products
    (code, name, product_type_id, family_id, category_id, stock_unit_id, is_stockable, is_lot_controlled,
     is_purchased, is_sold, is_manufactured, shelf_life_days, standard_cost)
SELECT 'SE-GRAN-PARA', 'Granulado de paracetamol (90 %)', pt.id, pf.id, pc.id, u.id, TRUE, TRUE, FALSE, FALSE, TRUE, 180, 12.20
  FROM public.catalogs_product_types pt, public.catalogs_product_families pf, public.catalogs_product_categories pc, public.catalogs_units u
 WHERE pt.code = 'SE' AND pf.code = 'INSUMO' AND pc.code = 'INSUMOS' AND u.code = 'KG';

INSERT INTO public.routes (code, name, production_center_id, base_quantity)
SELECT s.code, s.name, c.id, s.base
  FROM (VALUES ('R-GRANULADO', 'Granulación por vía húmeda', 100.0),
               ('R-TABLETAS',  'Tableteado y acondicionamiento', 1000.0)) AS s(code, name, base)
 CROSS JOIN public.production_centers c WHERE c.code = 'SOLIDOS';

INSERT INTO public.routes_data (route_id, sequence, stage_id, work_center_id, setup_hours, run_hours)
SELECT r.id, s.seq, st.id, wc.id, s.setup, s.run
FROM (VALUES
    ('R-GRANULADO', 10, 'PESADA',      'BAL-01', 0.25, 0.75),
    ('R-GRANULADO', 20, 'GRANULACION', 'GRA-01', 0.50, 2.50),
    ('R-TABLETAS',  10, 'COMPRESION',  'TAB-01', 1.00, 1.50),
    ('R-TABLETAS',  20, 'CONTROL',     'LAB-IPC', 0.00, 0.50),
    ('R-TABLETAS',  30, 'ACONDIC',     'BLI-01', 0.50, 2.00)
) AS s(route, seq, stage, wc, setup, run)
JOIN public.routes r ON r.code = s.route
JOIN public.stages st ON st.code = s.stage
JOIN public.work_centers wc ON wc.code = s.wc;

INSERT INTO public.formulas (code, name, product_id, version, is_default, base_quantity, route_id, valid_from)
SELECT s.code, s.name, p.id, 1, TRUE, s.base, r.id, CURRENT_DATE - 30
  FROM (VALUES ('F-GRAN-PARA-1', 'Granulado de paracetamol v1', 'SE-GRAN-PARA', 100.0, 'R-GRANULADO'),
               ('F-PARA500-1',   'Paracetamol 500 mg x 20 v1',  'PT-PARA500-20', 1000.0, 'R-TABLETAS')) AS s(code, name, product, base, route)
  JOIN public.products p ON p.code = s.product
  JOIN public.routes r ON r.code = s.route;

-- 1 caja = 20 tabletas de 555 mg (500 mg de paracetamol) → 11,1 kg de granulado por 1.000 cajas
INSERT INTO public.formulas_details (formula_id, line_no, component_id, quantity, scrap_pct, is_critical, stage_id)
SELECT f.id, s.line, p.id, s.qty, s.scrap, s.critical, st.id
FROM (VALUES
    ('F-GRAN-PARA-1', 1, 'MP-PARACETAMOL', 90.0,   1.0, TRUE,  'PESADA'),
    ('F-GRAN-PARA-1', 2, 'MP-ALMIDON',      9.5,   1.0, FALSE, 'PESADA'),
    ('F-GRAN-PARA-1', 3, 'MP-ESTEARATO',    0.5,   0.0, FALSE, 'PESADA'),
    ('F-PARA500-1',   1, 'SE-GRAN-PARA',   11.1,   1.0, TRUE,  'COMPRESION'),
    ('F-PARA500-1',   2, 'ME-BLISTER',   2000.0,   2.0, FALSE, 'ACONDIC'),
    ('F-PARA500-1',   3, 'ME-CAJA-PARA20',1000.0,  1.0, FALSE, 'ACONDIC')
) AS s(formula, line, product, qty, scrap, critical, stage)
JOIN public.formulas f ON f.code = s.formula
JOIN public.products p ON p.code = s.product
JOIN public.stages st ON st.code = s.stage;
