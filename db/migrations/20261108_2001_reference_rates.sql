-- =====================================================================
--  FabriHub · Tasas de cambio referenciales
--
--  Si la fuente oficial (BCV, BCCR) no responde o la empresa aún no tiene token, una moneda de
--  referencia sin ninguna tasa vigente quedaría fuera del punto de venta y del tablero. Para esos
--  casos cada país trae un valor referencial: unidades de la moneda LOCAL por 1 unidad de cada
--  moneda (igual que cotiza el banco central). La API lo registra con source = 'REF' e
--  is_automatic = TRUE, así la primera consulta oficial correcta del mismo día lo reemplaza.
-- =====================================================================

ALTER TABLE public.catalogs_countries ADD COLUMN reference_rates JSONB NOT NULL DEFAULT '{}';
COMMENT ON COLUMN public.catalogs_countries.reference_rates IS
    'Tasa referencial por moneda en moneda local ({"USD": 505}); se usa solo si no hay tasa oficial ni manual';

UPDATE public.catalogs_countries SET reference_rates = '{"USD": 36.5, "EUR": 42.5}' WHERE code = 'VE';
UPDATE public.catalogs_countries SET reference_rates = '{"USD": 505, "EUR": 585}' WHERE code = 'CR';
