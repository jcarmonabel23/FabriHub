-- =====================================================================
--  FabriHub · 20261004_0402_quality_seed.sql   (fase 4 · Calidad + datos)
--  Registro de decisiones de calidad sobre lotes (buenas prácticas de
--  fabricación: quién liberó qué, cuándo y con qué análisis), datos de
--  demostración de compras y activación de los módulos.
-- =====================================================================

CREATE TABLE public.lots_quality_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lot_id UUID NOT NULL REFERENCES public.lots(id) ON DELETE CASCADE,
    from_status VARCHAR(12) NOT NULL,
    to_status VARCHAR(12) NOT NULL,
    analysis_ref VARCHAR(60),
    notes VARCHAR(800) NOT NULL,
    decided_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE public.lots_quality_events IS 'Decisiones de Calidad sobre lotes (aprobación, rechazo): registro inmutable';
COMMENT ON COLUMN public.lots_quality_events.id IS 'Identificador único';
COMMENT ON COLUMN public.lots_quality_events.lot_id IS 'Lote';
COMMENT ON COLUMN public.lots_quality_events.from_status IS 'Estado anterior';
COMMENT ON COLUMN public.lots_quality_events.to_status IS 'Estado resultante';
COMMENT ON COLUMN public.lots_quality_events.analysis_ref IS 'Referencia del certificado o análisis de laboratorio';
COMMENT ON COLUMN public.lots_quality_events.notes IS 'Fundamento de la decisión';
COMMENT ON COLUMN public.lots_quality_events.decided_by IS 'Quién decidió (nunca quien recibió o fabricó el lote)';
COMMENT ON COLUMN public.lots_quality_events.decided_at IS 'Cuándo';
CREATE INDEX idx_lots_quality_events_lot ON public.lots_quality_events (lot_id, decided_at DESC);

REVOKE UPDATE, DELETE, TRUNCATE ON public.lots_quality_events FROM :"app_user";

-- --------------------------------------------------------------- Datos de demostración
INSERT INTO public.buyers (order_list, code, name, email, phone) VALUES
    (1, 'MPEREZ', 'María Pérez', 'compras@empresa-demo.local', '0251-5550101'),
    (2, 'JROJAS', 'José Rojas', 'jrojas@empresa-demo.local', '0251-5550102');

INSERT INTO public.price_lists (code, name, scope, currency_id, valid_from)
SELECT x.code, x.name, 'purchases', c.id, DATE '2026-01-01'
FROM (VALUES ('QUIMIVEN-26', 'Química del Centro 2026', 'USD'),
             ('EMPAQUES-26', 'Empaques del Lara 2026', 'VES')) AS x(code, name, currency)
JOIN public.catalogs_currencies c ON c.code = x.currency;

-- Proveedores ficticios (RIF con formato válido, sin correspondencia con empresas reales)
INSERT INTO public.suppliers
    (code, legal_name, trade_name, rif, phones, email, city, state, payment_term_id, delivery_term_id, delivery_method_id,
     zone_id, business_type_id, buyer_id, price_list_id, fiscal_treatment_id, currency_id, payable_account)
SELECT s.code, s.legal_name, s.trade_name, s.rif, s.phones::jsonb, s.email, s.city, s.state,
       pt.id, dt.id, dm.id, z.id, bt.id, b.id, pl.id, ft.id, cur.id, '2.1.01.01'
FROM (VALUES
    ('QUIMIVEN', 'Química del Centro, C.A. (demo)', 'Quimiven', 'J-40000001-1', '["0241-5550001"]', 'ventas@quimiven-demo.local',
     'Valencia', 'Carabobo', 'CR30', 'DAP', 'TERCERO', 'CENTRAL', 'MP', 'MPEREZ', 'QUIMIVEN-26', 'G16_RIVA75', 'USD'),
    ('EMPAQUES', 'Empaques del Lara, S.A. (demo)', 'Emplara', 'J-40000002-2', '["0251-5550002"]', 'pedidos@emplara-demo.local',
     'Barquisimeto', 'Lara', 'CR15', 'DAP', 'PROPIO', 'OCCIDENTE', 'EMPAQUE', 'JROJAS', 'EMPAQUES-26', 'G16_RIVA75', 'VES'),
    ('LABANALIS', 'Laboratorio de Análisis Externo, C.A. (demo)', 'LabAnalis', 'J-40000003-3', '[]', 'contacto@labanalis-demo.local',
     'Caracas', 'Distrito Capital', 'CONTADO', NULL, NULL, 'CAPITAL', 'SERVICIOS', 'MPEREZ', NULL, 'G16_RIVA75', 'VES')
) AS s(code, legal_name, trade_name, rif, phones, email, city, state, pt, dt, dm, zone, bt, buyer, pl, ft, cur)
LEFT JOIN public.catalogs_payment_terms pt ON pt.code = s.pt
LEFT JOIN public.catalogs_delivery_terms dt ON dt.code = s.dt
LEFT JOIN public.catalogs_delivery_methods dm ON dm.code = s.dm
LEFT JOIN public.catalogs_zones z ON z.code = s.zone
LEFT JOIN public.catalogs_business_types bt ON bt.code = s.bt
LEFT JOIN public.buyers b ON b.code = s.buyer
LEFT JOIN public.price_lists pl ON pl.code = s.pl
LEFT JOIN public.fiscal_treatments ft ON ft.code = s.ft
LEFT JOIN public.catalogs_currencies cur ON cur.code = s.cur;

INSERT INTO public.suppliers_contacts (supplier_id, name, position, phone, email, is_primary)
SELECT s.id, c.name, c.position, c.phone, c.email, TRUE
FROM (VALUES ('QUIMIVEN', 'Ana Torres', 'Ejecutiva de ventas', '0414-5550011', 'atorres@quimiven-demo.local'),
             ('EMPAQUES', 'Luis Méndez', 'Gerente comercial', '0424-5550022', 'lmendez@emplara-demo.local')) AS c(sup, name, position, phone, email)
JOIN public.suppliers s ON s.code = c.sup;

INSERT INTO public.price_lists_items (price_list_id, product_id, price, promo_price, promo_from, promo_to)
SELECT pl.id, p.id, i.price, i.promo, i.pfrom, i.pto
FROM (VALUES
    ('QUIMIVEN-26', 'MP-PARACETAMOL', 13.20, NULL::numeric, NULL::date, NULL::date),
    ('QUIMIVEN-26', 'MP-IBUPROFENO',  19.00, 17.50, DATE '2026-09-01', DATE '2026-12-31'),
    ('QUIMIVEN-26', 'MP-ALMIDON',      1.30, NULL, NULL, NULL),
    ('QUIMIVEN-26', 'MP-ESTEARATO',    8.40, NULL, NULL, NULL),
    ('EMPAQUES-26', 'ME-BLISTER',     32.00, NULL, NULL, NULL),
    ('EMPAQUES-26', 'ME-CAJA-PARA20', 52.00, NULL, NULL, NULL)
) AS i(list, product, price, promo, pfrom, pto)
JOIN public.price_lists pl ON pl.code = i.list
JOIN public.products p ON p.code = i.product;

-- Tasa del día para poder comprar en USD en la demostración (valor ilustrativo)
INSERT INTO public.currencies_rates (currency_id, rate_date, rate, source)
SELECT id, CURRENT_DATE, 36.50, 'DEMO' FROM public.catalogs_currencies WHERE code = 'USD'
ON CONFLICT (currency_id, rate_date) DO NOTHING;

-- --------------------------------------------------------------- Activar la fase 4
UPDATE public.catalogs_modules SET is_offline = FALSE
 WHERE code IN ('PURCHASES', 'PUR_SUPPLIERS', 'PUR_BUYERS', 'PUR_PRICE_LISTS', 'PUR_ORDERS', 'PUR_RECEPTIONS',
                'QUALITY', 'QC_LOTS');
