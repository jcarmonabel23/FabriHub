-- =====================================================================
--  FabriHub · 20261004_0304_inventory_views_seed.sql   (fase 3)
--  Vistas de alertas (justificación de la tesis 1.2: "mecanismos de alarma"),
--  datos de demostración del caso farmacéutico y activación de los módulos.
-- =====================================================================

-- --------------------------------------------------------------- Alertas de stock
CREATE VIEW public.v_stock_alerts AS
SELECT
    pol.warehouse_id,
    w.code AS warehouse_code,
    w.name AS warehouse_name,
    pol.product_id,
    p.code AS product_code,
    p.name AS product_name,
    u.code AS unit_code,
    COALESCE(v.quantity, 0) AS quantity,
    pol.min_qty,
    pol.max_qty,
    CASE WHEN COALESCE(v.quantity, 0) < pol.min_qty THEN 'below_min' ELSE 'above_max' END AS kind
FROM public.stock_policies pol
JOIN public.warehouses w ON w.id = pol.warehouse_id
JOIN public.products p ON p.id = pol.product_id
JOIN public.catalogs_units u ON u.id = p.stock_unit_id
LEFT JOIN public.stock_valuation v ON v.warehouse_id = pol.warehouse_id AND v.product_id = pol.product_id
WHERE p.is_active
  AND (COALESCE(v.quantity, 0) < pol.min_qty OR (pol.max_qty IS NOT NULL AND COALESCE(v.quantity, 0) > pol.max_qty));

COMMENT ON VIEW public.v_stock_alerts IS 'Productos por debajo del mínimo o por encima del máximo en cada almacén';

-- --------------------------------------------------------------- Lotes por vencer
CREATE VIEW public.v_lots_expiring AS
SELECT
    l.id AS lot_id,
    l.lot_code,
    l.internal_number,
    l.expires_on,
    l.quality_status,
    (l.expires_on - CURRENT_DATE) AS days_left,
    CASE WHEN l.expires_on < CURRENT_DATE THEN 'expired' ELSE 'expiring' END AS kind,
    p.id AS product_id,
    p.code AS product_code,
    p.name AS product_name,
    u.code AS unit_code,
    s.quantity
FROM public.lots l
JOIN public.products p ON p.id = l.product_id
JOIN public.catalogs_units u ON u.id = p.stock_unit_id
JOIN (SELECT lot_id, SUM(quantity) AS quantity FROM public.stock_balances WHERE lot_id IS NOT NULL
      GROUP BY lot_id HAVING SUM(quantity) > 0) s ON s.lot_id = l.id
WHERE l.expires_on IS NOT NULL
  AND l.expires_on <= CURRENT_DATE + COALESCE((public.fn_parameter('INVENTORY', 'expiry_alert_days'))::text::int, 90);

COMMENT ON VIEW public.v_lots_expiring IS 'Lotes con existencia vencidos o que vencen dentro de los días del parámetro expiry_alert_days';

-- --------------------------------------------------------------- Almacenes de demostración
INSERT INTO public.warehouses (order_list, code, name, kind, address) VALUES
    (1, 'MP', 'Materia prima', 'storage', 'Planta Nirgua, galpón 1'),
    (2, 'ME', 'Material de empaque', 'storage', 'Planta Nirgua, galpón 1'),
    (3, 'PLANTA', 'Planta de producción', 'production', 'Planta Nirgua, área de fabricación'),
    (4, 'PT', 'Producto terminado', 'storage', 'Planta Nirgua, galpón 2');

-- --------------------------------------------------------------- Productos de demostración
-- Nombres genéricos (sin marcas). Los medicamentos son exentos de IVA; la vitamina va gravada como ejemplo.
INSERT INTO public.products
    (code, name, product_type_id, family_id, category_id, stock_unit_id, purchase_unit_id, purchase_factor,
     sale_unit_id, sale_factor, is_stockable, is_lot_controlled, is_purchased, is_sold, is_manufactured,
     shelf_life_days, fiscal_treatment_id, sale_price, purchase_price)
SELECT s.code, s.name, pt.id, pf.id, pc.id, su.id, pu.id, s.pfactor, sl.id, s.sfactor,
       s.stockable, s.lot, s.purchased, s.sold, s.manufactured, s.shelf, ft.id, s.sale_price, s.purchase_price
FROM (VALUES
    ('MP-PARACETAMOL', 'Paracetamol polvo USP',                     'MP', 'INSUMO', 'INSUMOS', 'KG',   'KG',   1,    NULL,   1,  TRUE,  TRUE,  TRUE,  FALSE, FALSE, 1095, NULL,         NULL,   12.50),
    ('MP-IBUPROFENO',  'Ibuprofeno polvo USP',                      'MP', 'INSUMO', 'INSUMOS', 'KG',   'KG',   1,    NULL,   1,  TRUE,  TRUE,  TRUE,  FALSE, FALSE, 1095, NULL,         NULL,   18.00),
    ('MP-ALMIDON',     'Almidón de maíz',                           'MP', 'INSUMO', 'INSUMOS', 'KG',   'KG',   1,    NULL,   1,  TRUE,  TRUE,  TRUE,  FALSE, FALSE,  730, NULL,         NULL,    1.20),
    ('MP-ESTEARATO',   'Estearato de magnesio',                     'MP', 'INSUMO', 'INSUMOS', 'KG',   'KG',   1,    NULL,   1,  TRUE,  TRUE,  TRUE,  FALSE, FALSE,  730, NULL,         NULL,    8.00),
    ('ME-BLISTER',     'Blíster PVC/aluminio 10 cavidades',         'ME', 'INSUMO', 'INSUMOS', 'UND',  'MILLAR', 1000, NULL, 1,  TRUE,  FALSE, TRUE,  FALSE, FALSE, NULL, NULL,         NULL,   30.00),
    ('ME-CAJA-PARA20', 'Caja plegadiza Paracetamol x 20',           'ME', 'INSUMO', 'INSUMOS', 'UND',  'MILLAR', 1000, NULL, 1,  TRUE,  FALSE, TRUE,  FALSE, FALSE, NULL, NULL,         NULL,   50.00),
    ('PT-PARA500-20',  'Paracetamol 500 mg x 20 tabletas',          'PT', 'ANALG',  'SOLIDOS', 'CAJA', NULL,   1,    'CAJA', 1,  TRUE,  TRUE,  FALSE, TRUE,  TRUE,   730, 'EXENTO',      3.50,   NULL),
    ('PT-IBU400-10',   'Ibuprofeno 400 mg x 10 tabletas',           'PT', 'ANALG',  'SOLIDOS', 'CAJA', NULL,   1,    'CAJA', 1,  TRUE,  TRUE,  FALSE, TRUE,  TRUE,   730, 'EXENTO',      4.20,   NULL),
    ('PT-VITC500-30',  'Vitamina C 500 mg x 30 tabletas',           'PT', 'VITAM',  'SOLIDOS', 'CAJA', NULL,   1,    'CAJA', 1,  TRUE,  TRUE,  FALSE, TRUE,  TRUE,   540, 'G16',         5.10,   NULL),
    ('SV-ANALISIS',    'Análisis de laboratorio externo',           'SV', NULL,     NULL,      'H',    'H',    1,    NULL,   1,  FALSE, FALSE, TRUE,  FALSE, FALSE, NULL, 'G16_RIVA75',  NULL,   40.00)
) AS s(code, name, type_code, family_code, category_code, stock_unit, purchase_unit, pfactor, sale_unit, sfactor,
       stockable, lot, purchased, sold, manufactured, shelf, treatment, sale_price, purchase_price)
JOIN public.catalogs_product_types pt ON pt.code = s.type_code
JOIN public.catalogs_units su ON su.code = s.stock_unit
LEFT JOIN public.catalogs_product_families pf ON pf.code = s.family_code
LEFT JOIN public.catalogs_product_categories pc ON pc.code = s.category_code
LEFT JOIN public.catalogs_units pu ON pu.code = s.purchase_unit
LEFT JOIN public.catalogs_units sl ON sl.code = s.sale_unit
LEFT JOIN public.fiscal_treatments ft ON ft.code = s.treatment;

INSERT INTO public.products_relations (product_id, related_product_id, kind, notes)
SELECT a.id, b.id, 'equivalent', 'Analgésico alternativo ante inexistencia'
FROM public.products a, public.products b WHERE a.code = 'PT-PARA500-20' AND b.code = 'PT-IBU400-10';

-- --------------------------------------------------------------- Inventario inicial de demostración
-- Se registra con el MISMO motor que usa la app (fn_post_inventory_movement): nada se escribe a mano.
DO $$
DECLARE
    v_concept UUID := (SELECT id FROM public.catalogs_movement_concepts WHERE code = 'INV_INI');
    v_mov UUID;
    w RECORD;
    v_line INTEGER;
    i RECORD;
    v_lot UUID;
BEGIN
    FOR w IN SELECT * FROM (VALUES ('MP'), ('ME'), ('PT')) AS x(code) LOOP
        INSERT INTO public.inventory_movements (number, movement_date, concept_id, direction, warehouse_id, reference, notes)
        SELECT public.fn_next_document_number('MOV'), CURRENT_DATE - 30, v_concept, 'in', id, 'DEMO', 'Inventario inicial de demostración'
          FROM public.warehouses WHERE code = w.code
        RETURNING id INTO v_mov;

        v_line := 0;
        FOR i IN
            SELECT * FROM (VALUES
                ('MP', 'MP-PARACETAMOL', 'PAR-2601', 250.0,  12.50, DATE '2028-12-31'),
                ('MP', 'MP-IBUPROFENO',  'IBU-2601', 120.0,  18.00, DATE '2028-10-31'),
                ('MP', 'MP-ALMIDON',     'ALM-2601', 400.0,   1.20, DATE '2027-12-31'),
                ('MP', 'MP-ESTEARATO',   'EST-2601',  25.0,   8.00, DATE '2027-06-30'),
                ('ME', 'ME-BLISTER',     NULL,     20000.0,   0.03, NULL),
                ('ME', 'ME-CAJA-PARA20', NULL,     10000.0,   0.05, NULL),
                ('PT', 'PT-PARA500-20',  'L2601',   1200.0,   1.10, DATE '2028-01-31'),
                ('PT', 'PT-IBU400-10',   'L2601',    800.0,   1.60, DATE '2028-02-29'),
                ('PT', 'PT-VITC500-30',  'L2509',    300.0,   2.10, CURRENT_DATE + 45)
            ) AS x(wh, product, lot, qty, cost, expires)
            WHERE x.wh = w.code
        LOOP
            v_line := v_line + 1;
            v_lot := NULL;
            IF i.lot IS NOT NULL THEN
                INSERT INTO public.lots (product_id, lot_code, expires_on, received_on, quality_status, unit_cost, origin_movement_id)
                SELECT id, i.lot, i.expires, CURRENT_DATE - 30, 'approved', i.cost, v_mov FROM public.products WHERE code = i.product
                RETURNING id INTO v_lot;
            END IF;
            INSERT INTO public.inventory_movements_details (movement_id, line_no, product_id, lot_id, quantity, unit_cost)
            SELECT v_mov, v_line, id, v_lot, i.qty, i.cost FROM public.products WHERE code = i.product;
        END LOOP;

        PERFORM public.fn_post_inventory_movement(v_mov);
    END LOOP;
END
$$;

-- Políticas de stock (una de ellas dispara la alerta de mínimo)
INSERT INTO public.stock_policies (warehouse_id, product_id, min_qty, max_qty)
SELECT w.id, p.id, s.min_qty, s.max_qty
FROM (VALUES
    ('MP', 'MP-PARACETAMOL', 100, 600),
    ('MP', 'MP-ALMIDON',     150, NULL),
    ('PT', 'PT-PARA500-20',  500, 3000),
    ('PT', 'PT-VITC500-30',  500, 2000)
) AS s(wh, product, min_qty, max_qty)
JOIN public.warehouses w ON w.code = s.wh
JOIN public.products p ON p.code = s.product;

-- --------------------------------------------------------------- Activar la fase 3
UPDATE public.catalogs_modules SET is_offline = FALSE
 WHERE code IN ('INVENTORY', 'INV_PRODUCTS', 'INV_CATALOGS', 'INV_WAREHOUSES', 'INV_LOTS', 'INV_MOVEMENTS', 'INV_STOCK');
