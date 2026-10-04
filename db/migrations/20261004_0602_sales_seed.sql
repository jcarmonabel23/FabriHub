-- =====================================================================
--  FabriHub · 20261004_0602_sales_seed.sql   (fase 6)
--  Datos de demostración de Ventas y activación de los módulos.
-- =====================================================================

INSERT INTO public.sellers (order_list, code, name, phone, email, commission_pct) VALUES
    (1, 'AGOMEZ',  'Ana Gómez',     '0414-5550101', 'agomez@fabrihub.local', 2.5),
    (2, 'LMARTIN', 'Luis Martínez', '0424-5550102', 'lmartinez@fabrihub.local', 2.0);

-- Listas de precios de venta (mismo motor que Compras, scope 'sales')
INSERT INTO public.price_lists (code, name, scope, currency_id, valid_from, notes)
SELECT s.code, s.name, 'sales', c.id, CURRENT_DATE - 60, s.notes
  FROM (VALUES ('PVP-26', 'Precio de venta a farmacias 2026', 'Lista general'),
               ('DROG-26', 'Precio a droguerías 2026', 'Mayoristas: precio menor por volumen')) AS s(code, name, notes)
  CROSS JOIN public.catalogs_currencies c WHERE c.code = 'VES';

INSERT INTO public.price_lists_items (price_list_id, product_id, price, promo_price, promo_from, promo_to)
SELECT l.id, p.id, s.price, s.promo, CASE WHEN s.promo IS NOT NULL THEN CURRENT_DATE - 5 END, CASE WHEN s.promo IS NOT NULL THEN CURRENT_DATE + 25 END
FROM (VALUES
    ('PVP-26',  'PT-PARA500-20', 3.60, NULL::numeric),
    ('PVP-26',  'PT-IBU400-10',  4.30, NULL),
    ('PVP-26',  'PT-VITC500-30', 5.20, 4.70),
    ('DROG-26', 'PT-PARA500-20', 3.20, NULL),
    ('DROG-26', 'PT-IBU400-10',  3.90, NULL),
    ('DROG-26', 'PT-VITC500-30', 4.80, NULL)
) AS s(list, product, price, promo)
JOIN public.price_lists l ON l.code = s.list
JOIN public.products p ON p.code = s.product;

-- Clientes: una droguería contribuyente especial (nos retiene IVA), una farmacia y un hospital
INSERT INTO public.customers
    (code, legal_name, trade_name, rif, phones, email, address, delivery_address, city, state, payment_term_id, delivery_term_id,
     delivery_method_id, zone_id, business_type_id, seller_id, price_list_id, fiscal_treatment_id, currency_id, is_withholding_agent,
     credit_limit, receivable_account, income_account)
SELECT s.code, s.legal_name, s.trade_name, s.rif, s.phones::jsonb, s.email, s.address, s.address, s.city, s.state,
       pt.id, dt.id, dm.id, z.id, bt.id, se.id, pl.id, ft.id, cur.id, s.agent, s.credit, '1.1.03.01', '4.1.01.01'
FROM (VALUES
    ('DROCENTRO', 'Droguería del Centro, C.A. (demo)', 'Drocentro', 'J-41000001-0', '["0241-5551001"]', 'compras@drocentro-demo.local',
     'Zona Industrial Sur, Valencia', 'Valencia', 'Carabobo', 'CR30', 'DAP', 'PROPIO', 'CENTRAL', 'DROGUERIA', 'AGOMEZ', 'DROG-26', 'G16_RIVA75', TRUE, 50000.00),
    ('FARMAVIDA', 'Farmacias Vida, S.A. (demo)', 'FarmaVida', 'J-41000002-1', '["0212-5551002"]', 'pedidos@farmavida-demo.local',
     'Av. Libertador, Caracas', 'Caracas', 'Distrito Capital', 'CR15', 'DAP', 'TERCERO', 'CAPITAL', 'FARMACIA', 'LMARTIN', 'PVP-26', 'G16', FALSE, 2000.00),
    ('HOSPSUR', 'Hospital Clínico del Sur (demo)', 'Clínico del Sur', 'G-20000003-4', '[]', 'farmacia@clinicosur-demo.local',
     'Av. Bolívar, San Carlos', 'San Carlos', 'Cojedes', 'CONTADO', NULL, 'RETIRO', 'LLANOS', 'HOSPITAL', 'AGOMEZ', 'PVP-26', 'G16', FALSE, NULL)
) AS s(code, legal_name, trade_name, rif, phones, email, address, city, state, pt, dt, dm, zone, bt, seller, pl, ft, agent, credit)
LEFT JOIN public.catalogs_payment_terms pt ON pt.code = s.pt
LEFT JOIN public.catalogs_delivery_terms dt ON dt.code = s.dt
LEFT JOIN public.catalogs_delivery_methods dm ON dm.code = s.dm
LEFT JOIN public.catalogs_zones z ON z.code = s.zone
LEFT JOIN public.catalogs_business_types bt ON bt.code = s.bt
LEFT JOIN public.sellers se ON se.code = s.seller
LEFT JOIN public.price_lists pl ON pl.code = s.pl
LEFT JOIN public.fiscal_treatments ft ON ft.code = s.ft
CROSS JOIN public.catalogs_currencies cur
WHERE cur.code = 'VES';

INSERT INTO public.customers_contacts (customer_id, name, position, phone, email, is_primary)
SELECT c.id, s.name, s.position, s.phone, s.email, TRUE
  FROM (VALUES ('DROCENTRO', 'María Rodríguez', 'Jefa de compras', '0414-5552001', 'mrodriguez@drocentro-demo.local'),
               ('FARMAVIDA', 'Pedro Salas', 'Coordinador de inventario', '0424-5552002', 'psalas@farmavida-demo.local')) AS s(customer, name, position, phone, email)
  JOIN public.customers c ON c.code = s.customer;

-- Un segundo lote de Paracetamol que vence ANTES: el FEFO debe despacharlo primero.
DO $$
DECLARE
    v_mov UUID;
    v_lot UUID;
BEGIN
    INSERT INTO public.inventory_movements (number, movement_date, concept_id, direction, warehouse_id, reference, notes)
    SELECT public.fn_next_document_number('MOV'), CURRENT_DATE - 15, c.id, 'in', w.id, 'DEMO', 'Lote de demostración para FEFO'
      FROM public.catalogs_movement_concepts c, public.warehouses w WHERE c.code = 'INV_INI' AND w.code = 'PT'
    RETURNING id INTO v_mov;

    INSERT INTO public.lots (product_id, lot_code, manufactured_on, expires_on, received_on, quality_status, unit_cost, origin_movement_id)
    SELECT id, 'L2508', CURRENT_DATE - 400, CURRENT_DATE + 100, CURRENT_DATE - 15, 'approved', 1.05, v_mov
      FROM public.products WHERE code = 'PT-PARA500-20'
    RETURNING id INTO v_lot;

    INSERT INTO public.inventory_movements_details (movement_id, line_no, product_id, lot_id, quantity, unit_cost)
    SELECT v_mov, 1, id, v_lot, 300, 1.05 FROM public.products WHERE code = 'PT-PARA500-20';

    PERFORM public.fn_post_inventory_movement(v_mov);
END
$$;

-- --------------------------------------------------------------- Activar la fase 6
UPDATE public.catalogs_modules SET is_offline = FALSE
 WHERE code IN ('SALES', 'SAL_CUSTOMERS', 'SAL_SELLERS', 'SAL_PRICE_LISTS', 'SAL_ORDERS', 'SAL_DELIVERY_NOTES');
