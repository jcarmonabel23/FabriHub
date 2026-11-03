-- =====================================================================
--  FabriHub · Fase 15 · País de la empresa (Venezuela y Costa Rica)
--
--  · catalogs_countries: cada país con su moneda, zona horaria, tipos de identificación
--    fiscal (con su patrón ya normalizado) y lo que aplica en él (IGTF, retenciones,
--    contribuyente especial, comprobante electrónico).
--  · companies.country_code: el país de la empresa (se fija al crearla). La moneda CRC
--    (colón) se agrega al catálogo global.
--  · Identificación: la columna `rif` pasa a ser el número de identificación fiscal y se
--    acompaña de `id_type` (RIF, CI en VE; FISICA, JURIDICA, DIMEX, NITE, EXTRANJERO en CR).
--    Un trigger valida el número contra el patrón del país de la empresa dueña del registro;
--    reemplaza los CHECK de formato RIF.
--  · Impuestos, retenciones y tratamientos fiscales siguen siendo globales, pero llevan
--    `country_code` y RLS: cada empresa solo ve (y crea) los de su país. Las consultas
--    existentes no cambian. Las tarifas y tramos heredan la visibilidad de su padre.
--  · Zona horaria: fn_company_timezone() la da por empresa; la API fija TimeZone en cada
--    conexión, así CURRENT_DATE y now() siguen la hora local de la empresa.
-- =====================================================================

-- --------------------------------------------------------------- Países
CREATE TABLE IF NOT EXISTS public.catalogs_countries (
    code CHAR(2) PRIMARY KEY CHECK (code ~ '^[A-Z]{2}$'),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    order_list INTEGER NOT NULL DEFAULT 0,
    name VARCHAR(80) NOT NULL,
    currency_code VARCHAR(3) NOT NULL,
    timezone VARCHAR(40) NOT NULL,
    tax_id_label VARCHAR(30) NOT NULL,
    id_types JSONB NOT NULL CHECK (jsonb_typeof(id_types) = 'array' AND jsonb_array_length(id_types) > 0),
    features JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(features) = 'object'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.catalogs_countries IS 'Países donde puede operar una empresa, con su configuración fiscal';
COMMENT ON COLUMN public.catalogs_countries.code IS 'Código ISO 3166-1 alfa-2';
COMMENT ON COLUMN public.catalogs_countries.currency_code IS 'Moneda local (base por defecto de las empresas del país)';
COMMENT ON COLUMN public.catalogs_countries.timezone IS 'Zona horaria IANA: define la fecha y hora local de las empresas del país';
COMMENT ON COLUMN public.catalogs_countries.tax_id_label IS 'Cómo se llama la identificación fiscal en documentos y pantallas (RIF, Cédula)';
COMMENT ON COLUMN public.catalogs_countries.id_types IS 'Tipos de identificación: [{code, name, pattern, example, juridical, explicitOnly?}]; pattern se aplica al valor normalizado; explicitOnly = no se deduce del formato (patrón demasiado amplio)';
COMMENT ON COLUMN public.catalogs_countries.features IS 'Qué aplica en el país: igtf, withholdings, specialTaxpayer, eInvoice';

CREATE TRIGGER trg_catalogs_countries_updated_at BEFORE UPDATE ON public.catalogs_countries
    FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

INSERT INTO public.catalogs_countries (code, order_list, name, currency_code, timezone, tax_id_label, id_types, features) VALUES
    ('VE', 1, 'Venezuela', 'VES', 'America/Caracas', 'RIF',
     '[{"code":"RIF","name":"RIF","pattern":"^[VEJPG]-[0-9]{8}-[0-9]$","example":"J-12345678-9","juridical":true},
       {"code":"CI","name":"Cédula de identidad","pattern":"^[VE]-[0-9]{5,9}$","example":"V-12345678","juridical":false}]',
     '{"igtf":true,"withholdings":true,"specialTaxpayer":true,"eInvoice":false}'),
    ('CR', 2, 'Costa Rica', 'CRC', 'America/Costa_Rica', 'Cédula',
     '[{"code":"FISICA","name":"Cédula física","pattern":"^[1-9][0-9]{8}$","example":"112345678","juridical":false},
       {"code":"JURIDICA","name":"Cédula jurídica","pattern":"^[2-5][0-9]{9}$","example":"3101123456","juridical":true},
       {"code":"DIMEX","name":"DIMEX","pattern":"^[0-9]{11,12}$","example":"155812345678","juridical":false},
       {"code":"NITE","name":"NITE","pattern":"^[0-9]{10}$","example":"4000123456","juridical":false},
       {"code":"EXTRANJERO","name":"Extranjero no domiciliado","pattern":"^[A-Z0-9]{3,20}$","example":"A12345678","juridical":false,"explicitOnly":true}]',
     '{"igtf":false,"withholdings":false,"specialTaxpayer":false,"eInvoice":true}')
ON CONFLICT (code) DO NOTHING;

-- --------------------------------------------------------------- Colón costarricense
INSERT INTO public.catalogs_currencies (order_list, code, name, symbol, decimals)
VALUES (4, 'CRC', 'Colón costarricense', '₡', 2)
ON CONFLICT (code) DO NOTHING;

-- --------------------------------------------------------------- País e identificación de la empresa
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS country_code CHAR(2) NOT NULL DEFAULT 'VE'
    REFERENCES public.catalogs_countries(code) ON DELETE RESTRICT;
ALTER TABLE public.companies ALTER COLUMN country_code DROP DEFAULT;
COMMENT ON COLUMN public.companies.country_code IS 'País de la empresa: impuestos, identificación, moneda local y zona horaria';

ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS id_type VARCHAR(12);
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS id_type VARCHAR(12);
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS id_type VARCHAR(12);

-- Los existentes son venezolanos: RIF completo o cédula
UPDATE public.companies SET id_type = 'RIF' WHERE id_type IS NULL;
UPDATE public.customers SET id_type = CASE WHEN rif ~ '^[VE]-[0-9]{5,9}$' THEN 'CI' ELSE 'RIF' END WHERE id_type IS NULL;
UPDATE public.suppliers SET id_type = CASE WHEN rif ~ '^[VE]-[0-9]{5,9}$' THEN 'CI' ELSE 'RIF' END WHERE id_type IS NULL;

ALTER TABLE public.companies ALTER COLUMN id_type SET NOT NULL;
ALTER TABLE public.customers ALTER COLUMN id_type SET NOT NULL;
ALTER TABLE public.suppliers ALTER COLUMN id_type SET NOT NULL;

COMMENT ON COLUMN public.companies.rif IS 'Número de identificación fiscal, normalizado (RIF en VE, cédula en CR)';
COMMENT ON COLUMN public.customers.rif IS 'Número de identificación fiscal, normalizado (RIF o cédula en VE; cédula, DIMEX, NITE en CR)';
COMMENT ON COLUMN public.suppliers.rif IS 'Número de identificación fiscal, normalizado (RIF o cédula en VE; cédula, DIMEX, NITE en CR)';
COMMENT ON COLUMN public.companies.id_type IS 'Tipo de identificación (catalogs_countries.id_types del país)';
COMMENT ON COLUMN public.customers.id_type IS 'Tipo de identificación (catalogs_countries.id_types del país de la empresa)';
COMMENT ON COLUMN public.suppliers.id_type IS 'Tipo de identificación (catalogs_countries.id_types del país de la empresa)';

-- El formato depende del país: el CHECK fijo de RIF se reemplaza por el trigger de abajo
ALTER TABLE public.companies DROP CONSTRAINT IF EXISTS company_rif_check;
ALTER TABLE public.companies DROP CONSTRAINT IF EXISTS companies_rif_check;
ALTER TABLE public.customers DROP CONSTRAINT IF EXISTS customers_rif_check;
ALTER TABLE public.suppliers DROP CONSTRAINT IF EXISTS suppliers_rif_check;
ALTER TABLE public.companies ALTER COLUMN rif TYPE VARCHAR(20);
ALTER TABLE public.customers ALTER COLUMN rif TYPE VARCHAR(20);
ALTER TABLE public.suppliers ALTER COLUMN rif TYPE VARCHAR(20);

-- El nombre del país (texto libre heredado) queda alineado con el catálogo
UPDATE public.companies c SET country = k.name FROM public.catalogs_countries k WHERE k.code = c.country_code;

-- --------------------------------------------------------------- Funciones de país
CREATE OR REPLACE FUNCTION public.fn_company_country(p_company UUID)
RETURNS CHAR(2)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$ SELECT country_code FROM public.companies WHERE id = p_company $$;
COMMENT ON FUNCTION public.fn_company_country(UUID) IS 'País de una empresa';

CREATE OR REPLACE FUNCTION public.fn_current_country()
RETURNS CHAR(2)
LANGUAGE sql STABLE
AS $$ SELECT public.fn_company_country(public.fn_current_company()) $$;
COMMENT ON FUNCTION public.fn_current_country() IS 'País de la empresa activa (NULL sin empresa)';

CREATE OR REPLACE FUNCTION public.fn_company_timezone(p_company UUID)
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$ SELECT k.timezone FROM public.companies c JOIN public.catalogs_countries k ON k.code = c.country_code WHERE c.id = p_company $$;
COMMENT ON FUNCTION public.fn_company_timezone(UUID) IS 'Zona horaria de una empresa (la de su país); la API la fija en cada conexión';

CREATE OR REPLACE FUNCTION public.fn_country_has(p_feature TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$ SELECT COALESCE((SELECT (k.features ->> p_feature)::boolean FROM public.catalogs_countries k
                        WHERE k.code = public.fn_company_country(public.fn_current_company())), FALSE) $$;
COMMENT ON FUNCTION public.fn_country_has(TEXT) IS 'Si en el país de la empresa activa aplica la característica (igtf, withholdings, specialTaxpayer, eInvoice)';

-- Valida tipo y número de identificación contra el país de la empresa dueña del registro
CREATE OR REPLACE FUNCTION public.fn_check_tax_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_country CHAR(2);
    v_type JSONB;
BEGIN
    -- Ramas separadas: PL/pgSQL resuelve NEW.campo al ejecutar, y companies no tiene company_id
    IF TG_TABLE_NAME = 'companies' THEN
        v_country := NEW.country_code;
    ELSE
        v_country := public.fn_company_country(NEW.company_id);
    END IF;
    SELECT t INTO v_type
      FROM public.catalogs_countries k, jsonb_array_elements(k.id_types) t
     WHERE k.code = v_country AND t ->> 'code' = NEW.id_type;
    IF v_type IS NULL THEN
        RAISE EXCEPTION 'El tipo de identificación % no existe en el país %', NEW.id_type, v_country USING ERRCODE = 'P0001';
    END IF;
    IF NEW.rif !~ (v_type ->> 'pattern') THEN
        RAISE EXCEPTION '% inválida: % (ejemplo: %)', v_type ->> 'name', NEW.rif, v_type ->> 'example' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;
COMMENT ON FUNCTION public.fn_check_tax_id() IS 'Trigger: el número de identificación cumple el patrón de su tipo en el país de la empresa';

DROP TRIGGER IF EXISTS trg_companies_tax_id ON public.companies;
CREATE TRIGGER trg_companies_tax_id BEFORE INSERT OR UPDATE OF rif, id_type, country_code ON public.companies
    FOR EACH ROW EXECUTE FUNCTION public.fn_check_tax_id();
DROP TRIGGER IF EXISTS trg_customers_tax_id ON public.customers;
CREATE TRIGGER trg_customers_tax_id BEFORE INSERT OR UPDATE OF rif, id_type ON public.customers
    FOR EACH ROW EXECUTE FUNCTION public.fn_check_tax_id();
DROP TRIGGER IF EXISTS trg_suppliers_tax_id ON public.suppliers;
CREATE TRIGGER trg_suppliers_tax_id BEFORE INSERT OR UPDATE OF rif, id_type ON public.suppliers
    FOR EACH ROW EXECUTE FUNCTION public.fn_check_tax_id();

-- --------------------------------------------------------------- Catálogos fiscales por país
ALTER TABLE public.taxes ADD COLUMN IF NOT EXISTS country_code CHAR(2) NOT NULL DEFAULT 'VE' REFERENCES public.catalogs_countries(code);
ALTER TABLE public.withholdings ADD COLUMN IF NOT EXISTS country_code CHAR(2) NOT NULL DEFAULT 'VE' REFERENCES public.catalogs_countries(code);
ALTER TABLE public.fiscal_treatments ADD COLUMN IF NOT EXISTS country_code CHAR(2) NOT NULL DEFAULT 'VE' REFERENCES public.catalogs_countries(code);
-- Lo que se cree desde la API queda en el país de la empresa activa
ALTER TABLE public.taxes ALTER COLUMN country_code SET DEFAULT public.fn_current_country();
ALTER TABLE public.withholdings ALTER COLUMN country_code SET DEFAULT public.fn_current_country();
ALTER TABLE public.fiscal_treatments ALTER COLUMN country_code SET DEFAULT public.fn_current_country();
COMMENT ON COLUMN public.taxes.country_code IS 'País del impuesto';
COMMENT ON COLUMN public.withholdings.country_code IS 'País de la retención';
COMMENT ON COLUMN public.fiscal_treatments.country_code IS 'País del tratamiento fiscal';

-- El código es único por país (EXENTO existe en VE y en CR)
ALTER TABLE public.taxes DROP CONSTRAINT IF EXISTS taxes_code_key;
ALTER TABLE public.withholdings DROP CONSTRAINT IF EXISTS withholdings_code_key;
ALTER TABLE public.fiscal_treatments DROP CONSTRAINT IF EXISTS fiscal_treatments_code_key;
ALTER TABLE public.taxes ADD CONSTRAINT uq_taxes_country_code UNIQUE (country_code, code);
ALTER TABLE public.withholdings ADD CONSTRAINT uq_withholdings_country_code UNIQUE (country_code, code);
ALTER TABLE public.fiscal_treatments ADD CONSTRAINT uq_fiscal_treatments_country_code UNIQUE (country_code, code);

ALTER TABLE public.taxes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.withholdings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fiscal_treatments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.taxes_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.withholdings_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.withholdings_brackets ENABLE ROW LEVEL SECURITY;

CREATE POLICY p_country ON public.taxes USING (country_code = public.fn_current_country()) WITH CHECK (country_code = public.fn_current_country());
CREATE POLICY p_country ON public.withholdings USING (country_code = public.fn_current_country()) WITH CHECK (country_code = public.fn_current_country());
CREATE POLICY p_country ON public.fiscal_treatments USING (country_code = public.fn_current_country()) WITH CHECK (country_code = public.fn_current_country());
-- Tarifas y tramos: visibles si su padre lo es (la subconsulta ya pasa por la RLS del padre)
CREATE POLICY p_country ON public.taxes_rates
    USING (EXISTS (SELECT 1 FROM public.taxes t WHERE t.id = tax_id))
    WITH CHECK (EXISTS (SELECT 1 FROM public.taxes t WHERE t.id = tax_id));
CREATE POLICY p_country ON public.withholdings_rates
    USING (EXISTS (SELECT 1 FROM public.withholdings w WHERE w.id = withholding_id))
    WITH CHECK (EXISTS (SELECT 1 FROM public.withholdings w WHERE w.id = withholding_id));
CREATE POLICY p_country ON public.withholdings_brackets
    USING (EXISTS (SELECT 1 FROM public.withholdings_rates r WHERE r.id = withholding_rate_id))
    WITH CHECK (EXISTS (SELECT 1 FROM public.withholdings_rates r WHERE r.id = withholding_rate_id));

-- Un tratamiento solo puede usar tarifas y retenciones de su mismo país
CREATE OR REPLACE FUNCTION public.fn_check_treatment_country()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.taxes_rates r JOIN public.taxes t ON t.id = r.tax_id
                    WHERE r.id = NEW.tax_rate_id AND t.country_code = NEW.country_code)
       OR (NEW.withholding_rate_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM public.withholdings_rates r JOIN public.withholdings w ON w.id = r.withholding_id
             WHERE r.id = NEW.withholding_rate_id AND w.country_code = NEW.country_code)) THEN
        RAISE EXCEPTION 'La tarifa o la retención del tratamiento fiscal pertenece a otro país' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_fiscal_treatments_country ON public.fiscal_treatments;
CREATE TRIGGER trg_fiscal_treatments_country BEFORE INSERT OR UPDATE ON public.fiscal_treatments
    FOR EACH ROW EXECUTE FUNCTION public.fn_check_treatment_country();

-- Un producto, cliente o proveedor solo puede usar tratamientos fiscales del país de su empresa
CREATE OR REPLACE FUNCTION public.fn_check_party_treatment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.fiscal_treatment_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.fiscal_treatments f
         WHERE f.id = NEW.fiscal_treatment_id AND f.country_code = public.fn_company_country(NEW.company_id)) THEN
        RAISE EXCEPTION 'El tratamiento fiscal no corresponde al país de la empresa' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;
DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['products', 'customers', 'suppliers'] LOOP
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = t AND column_name = 'fiscal_treatment_id') THEN
            EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_treatment_country ON public.%1$I', t);
            EXECUTE format('CREATE TRIGGER trg_%1$s_treatment_country BEFORE INSERT OR UPDATE OF fiscal_treatment_id ON public.%1$I
                            FOR EACH ROW EXECUTE FUNCTION public.fn_check_party_treatment()', t);
        END IF;
    END LOOP;
END $$;

-- --------------------------------------------------------------- Impuestos de Costa Rica (Ley 9635)
INSERT INTO public.taxes (country_code, order_list, code, name, description, kind) VALUES
    ('CR', 1, 'IVA', 'Impuesto al Valor Agregado', 'Tarifa general 13 % y tarifas reducidas (Ley 9635)', 'vat')
ON CONFLICT (country_code, code) DO NOTHING;

INSERT INTO public.taxes_rates (tax_id, order_list, code, name, rate)
SELECT t.id, r.ord, r.code, r.name, r.rate
FROM (VALUES
    (1, 'G13', 'General',                      13.0000),
    (2, 'R4',  'Reducida 4 %',                  4.0000),
    (3, 'R2',  'Reducida 2 %',                  2.0000),
    (4, 'R1',  'Reducida 1 % (canasta básica)', 1.0000),
    (5, 'T0',  'Tarifa 0 %',                    0.0000),
    (6, 'EX',  'Exenta',                        0.0000)
) AS r(ord, code, name, rate)
JOIN public.taxes t ON t.country_code = 'CR' AND t.code = 'IVA'
ON CONFLICT (tax_id, code) DO NOTHING;

INSERT INTO public.fiscal_treatments (country_code, order_list, code, name, description, valid_from, tax_rate_id, calc_method)
SELECT 'CR', s.ord, s.code, s.name, s.description, DATE '2026-01-01', tr.id, 'product'
FROM (VALUES
    (1, 'G13',    'Gravado 13 %',               'Bienes y servicios con la tarifa general',                 'G13'),
    (2, 'R4',     'Reducido 4 %',               'Servicios de salud privados y boletos aéreos',             'R4'),
    (3, 'R2',     'Reducido 2 %',               'Medicamentos, seguros personales y servicios educativos',  'R2'),
    (4, 'R1',     'Reducido 1 %',               'Bienes de la canasta básica e insumos agropecuarios',      'R1'),
    (5, 'T0',     'Tarifa 0 %',                 'Exportaciones y operaciones con tarifa cero',              'T0'),
    (6, 'EXENTO', 'Exento',                     'Operaciones exentas (art. 8 de la Ley del IVA)',           'EX')
) AS s(ord, code, name, description, rate_code)
JOIN public.taxes t ON t.country_code = 'CR' AND t.code = 'IVA'
JOIN public.taxes_rates tr ON tr.tax_id = t.id AND tr.code = s.rate_code
ON CONFLICT (country_code, code) DO NOTHING;
