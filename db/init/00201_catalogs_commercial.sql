-- =====================================================================
--  FabriHub · 00201_catalogs_commercial.sql
--  Catálogos comerciales de la clase "Parámetros del Sistema" (tesis 4.2.2.1.6):
--  Condición de Pago, Condición de Entrega, Método de Entrega, Tipo de Negocio, Zona.
--  `applies_to` reemplaza al campo "Módulo" de la tesis (compras, ventas o ambos).
--  Todas comparten estructura; la API las administra con un motor genérico.
-- =====================================================================

-- --------------------------------------------------------------- Condiciones de pago
CREATE TABLE IF NOT EXISTS public.catalogs_payment_terms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    order_list INTEGER NOT NULL DEFAULT 0,
    code VARCHAR(20) NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9_-]+$'),
    name VARCHAR(80) NOT NULL,
    description VARCHAR(400),
    days INTEGER NOT NULL DEFAULT 0 CHECK (days BETWEEN 0 AND 365),
    applies_to VARCHAR(10) NOT NULL DEFAULT 'both' CHECK (applies_to IN ('purchases', 'sales', 'both')),
    metadata JSONB NOT NULL DEFAULT '{}',
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE public.catalogs_payment_terms IS 'Condiciones de pago de órdenes de compra y venta (tesis: Clase Condición de Pago)';
COMMENT ON COLUMN public.catalogs_payment_terms.id IS 'Identificador único';
COMMENT ON COLUMN public.catalogs_payment_terms.is_active IS 'Indica si está activa';
COMMENT ON COLUMN public.catalogs_payment_terms.order_list IS 'Orden de presentación';
COMMENT ON COLUMN public.catalogs_payment_terms.code IS 'Código de la condición de pago';
COMMENT ON COLUMN public.catalogs_payment_terms.name IS 'Nombre de la condición';
COMMENT ON COLUMN public.catalogs_payment_terms.description IS 'Descripción opcional';
COMMENT ON COLUMN public.catalogs_payment_terms.days IS 'Días de crédito que concede la condición (tesis: Nº de Días)';
COMMENT ON COLUMN public.catalogs_payment_terms.applies_to IS 'Módulo donde se usa: purchases, sales o both';
COMMENT ON COLUMN public.catalogs_payment_terms.metadata IS 'Datos adicionales libres';
COMMENT ON COLUMN public.catalogs_payment_terms.created_by IS 'Usuario que creó el registro';
COMMENT ON COLUMN public.catalogs_payment_terms.updated_by IS 'Usuario que modificó el registro por última vez';
COMMENT ON COLUMN public.catalogs_payment_terms.created_at IS 'Fecha y hora de creación';
COMMENT ON COLUMN public.catalogs_payment_terms.updated_at IS 'Fecha y hora de la última actualización';

-- --------------------------------------------------------------- Condiciones de entrega
CREATE TABLE IF NOT EXISTS public.catalogs_delivery_terms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    order_list INTEGER NOT NULL DEFAULT 0,
    code VARCHAR(20) NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9_-]+$'),
    name VARCHAR(80) NOT NULL,
    description VARCHAR(400),
    applies_to VARCHAR(10) NOT NULL DEFAULT 'both' CHECK (applies_to IN ('purchases', 'sales', 'both')),
    metadata JSONB NOT NULL DEFAULT '{}',
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE public.catalogs_delivery_terms IS 'Condiciones de entrega (tesis: Clase Condición de Entrega), p. ej. Incoterms';
COMMENT ON COLUMN public.catalogs_delivery_terms.id IS 'Identificador único';
COMMENT ON COLUMN public.catalogs_delivery_terms.is_active IS 'Indica si está activa';
COMMENT ON COLUMN public.catalogs_delivery_terms.order_list IS 'Orden de presentación';
COMMENT ON COLUMN public.catalogs_delivery_terms.code IS 'Código de la condición de entrega';
COMMENT ON COLUMN public.catalogs_delivery_terms.name IS 'Nombre de la condición';
COMMENT ON COLUMN public.catalogs_delivery_terms.description IS 'Descripción opcional';
COMMENT ON COLUMN public.catalogs_delivery_terms.applies_to IS 'Módulo donde se usa: purchases, sales o both';
COMMENT ON COLUMN public.catalogs_delivery_terms.metadata IS 'Datos adicionales libres';
COMMENT ON COLUMN public.catalogs_delivery_terms.created_by IS 'Usuario que creó el registro';
COMMENT ON COLUMN public.catalogs_delivery_terms.updated_by IS 'Usuario que modificó el registro por última vez';
COMMENT ON COLUMN public.catalogs_delivery_terms.created_at IS 'Fecha y hora de creación';
COMMENT ON COLUMN public.catalogs_delivery_terms.updated_at IS 'Fecha y hora de la última actualización';

-- --------------------------------------------------------------- Métodos de entrega
CREATE TABLE IF NOT EXISTS public.catalogs_delivery_methods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    order_list INTEGER NOT NULL DEFAULT 0,
    code VARCHAR(20) NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9_-]+$'),
    name VARCHAR(80) NOT NULL,
    description VARCHAR(400),
    applies_to VARCHAR(10) NOT NULL DEFAULT 'both' CHECK (applies_to IN ('purchases', 'sales', 'both')),
    metadata JSONB NOT NULL DEFAULT '{}',
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE public.catalogs_delivery_methods IS 'Métodos de entrega de mercancía (tesis: Clase Método de Entrega)';
COMMENT ON COLUMN public.catalogs_delivery_methods.id IS 'Identificador único';
COMMENT ON COLUMN public.catalogs_delivery_methods.is_active IS 'Indica si está activo';
COMMENT ON COLUMN public.catalogs_delivery_methods.order_list IS 'Orden de presentación';
COMMENT ON COLUMN public.catalogs_delivery_methods.code IS 'Código del método de entrega';
COMMENT ON COLUMN public.catalogs_delivery_methods.name IS 'Nombre del método';
COMMENT ON COLUMN public.catalogs_delivery_methods.description IS 'Descripción opcional';
COMMENT ON COLUMN public.catalogs_delivery_methods.applies_to IS 'Módulo donde se usa: purchases, sales o both';
COMMENT ON COLUMN public.catalogs_delivery_methods.metadata IS 'Datos adicionales libres';
COMMENT ON COLUMN public.catalogs_delivery_methods.created_by IS 'Usuario que creó el registro';
COMMENT ON COLUMN public.catalogs_delivery_methods.updated_by IS 'Usuario que modificó el registro por última vez';
COMMENT ON COLUMN public.catalogs_delivery_methods.created_at IS 'Fecha y hora de creación';
COMMENT ON COLUMN public.catalogs_delivery_methods.updated_at IS 'Fecha y hora de la última actualización';

-- --------------------------------------------------------------- Tipos de negocio
CREATE TABLE IF NOT EXISTS public.catalogs_business_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    order_list INTEGER NOT NULL DEFAULT 0,
    code VARCHAR(20) NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9_-]+$'),
    name VARCHAR(80) NOT NULL,
    description VARCHAR(400),
    applies_to VARCHAR(10) NOT NULL DEFAULT 'both' CHECK (applies_to IN ('purchases', 'sales', 'both')),
    metadata JSONB NOT NULL DEFAULT '{}',
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE public.catalogs_business_types IS 'Agrupación de clientes y proveedores por tipo de negocio (tesis: Clase Tipo de Negocio)';
COMMENT ON COLUMN public.catalogs_business_types.id IS 'Identificador único';
COMMENT ON COLUMN public.catalogs_business_types.is_active IS 'Indica si está activo';
COMMENT ON COLUMN public.catalogs_business_types.order_list IS 'Orden de presentación';
COMMENT ON COLUMN public.catalogs_business_types.code IS 'Código del tipo de negocio';
COMMENT ON COLUMN public.catalogs_business_types.name IS 'Nombre del tipo de negocio';
COMMENT ON COLUMN public.catalogs_business_types.description IS 'Descripción opcional';
COMMENT ON COLUMN public.catalogs_business_types.applies_to IS 'A quién agrupa: purchases (proveedores), sales (clientes) o both';
COMMENT ON COLUMN public.catalogs_business_types.metadata IS 'Datos adicionales libres';
COMMENT ON COLUMN public.catalogs_business_types.created_by IS 'Usuario que creó el registro';
COMMENT ON COLUMN public.catalogs_business_types.updated_by IS 'Usuario que modificó el registro por última vez';
COMMENT ON COLUMN public.catalogs_business_types.created_at IS 'Fecha y hora de creación';
COMMENT ON COLUMN public.catalogs_business_types.updated_at IS 'Fecha y hora de la última actualización';

-- --------------------------------------------------------------- Zonas
CREATE TABLE IF NOT EXISTS public.catalogs_zones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    order_list INTEGER NOT NULL DEFAULT 0,
    code VARCHAR(20) NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9_-]+$'),
    name VARCHAR(80) NOT NULL,
    description VARCHAR(400),
    metadata JSONB NOT NULL DEFAULT '{}',
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE public.catalogs_zones IS 'Zonas geográficas de clientes y proveedores (tesis: Clase Zona)';
COMMENT ON COLUMN public.catalogs_zones.id IS 'Identificador único';
COMMENT ON COLUMN public.catalogs_zones.is_active IS 'Indica si está activa';
COMMENT ON COLUMN public.catalogs_zones.order_list IS 'Orden de presentación';
COMMENT ON COLUMN public.catalogs_zones.code IS 'Código de la zona';
COMMENT ON COLUMN public.catalogs_zones.name IS 'Nombre de la zona';
COMMENT ON COLUMN public.catalogs_zones.description IS 'Descripción opcional';
COMMENT ON COLUMN public.catalogs_zones.metadata IS 'Datos adicionales libres';
COMMENT ON COLUMN public.catalogs_zones.created_by IS 'Usuario que creó el registro';
COMMENT ON COLUMN public.catalogs_zones.updated_by IS 'Usuario que modificó el registro por última vez';
COMMENT ON COLUMN public.catalogs_zones.created_at IS 'Fecha y hora de creación';
COMMENT ON COLUMN public.catalogs_zones.updated_at IS 'Fecha y hora de la última actualización';

-- --------------------------------------------------------------- Triggers comunes
DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['catalogs_payment_terms', 'catalogs_delivery_terms', 'catalogs_delivery_methods',
                             'catalogs_business_types', 'catalogs_zones'] LOOP
        EXECUTE format('CREATE TRIGGER trg_%1$s_updated_at BEFORE UPDATE ON public.%1$I
                        FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at()', t);
        EXECUTE format('CREATE TRIGGER trg_audit_%1$s AFTER INSERT OR UPDATE OR DELETE ON public.%1$I
                        FOR EACH ROW EXECUTE FUNCTION public.fn_audit()', t);
    END LOOP;
END
$$;

-- --------------------------------------------------------------- Semillas
INSERT INTO public.catalogs_payment_terms (order_list, code, name, days, applies_to) VALUES
    (1, 'CONTADO', 'Contado', 0, 'both'),
    (2, 'CR15', 'Crédito 15 días', 15, 'both'),
    (3, 'CR30', 'Crédito 30 días', 30, 'both'),
    (4, 'CR60', 'Crédito 60 días', 60, 'purchases')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.catalogs_delivery_terms (order_list, code, name, description, applies_to) VALUES
    (1, 'EXW', 'En planta (EXW)', 'El comprador retira en las instalaciones del vendedor', 'both'),
    (2, 'DAP', 'Entregado en destino (DAP)', 'El vendedor entrega en la dirección del comprador', 'both'),
    (3, 'CIF', 'Costo, seguro y flete (CIF)', 'Importaciones: el vendedor paga flete y seguro hasta el puerto', 'purchases')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.catalogs_delivery_methods (order_list, code, name, applies_to) VALUES
    (1, 'PROPIO', 'Transporte propio', 'both'),
    (2, 'TERCERO', 'Transporte contratado', 'both'),
    (3, 'RETIRO', 'Retiro por el cliente', 'sales'),
    (4, 'COURIER', 'Courier', 'both')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.catalogs_business_types (order_list, code, name, applies_to) VALUES
    (1, 'DROGUERIA', 'Droguería', 'sales'),
    (2, 'FARMACIA', 'Farmacia / cadena', 'sales'),
    (3, 'HOSPITAL', 'Hospital / clínica', 'sales'),
    (4, 'MP', 'Proveedor de materia prima', 'purchases'),
    (5, 'EMPAQUE', 'Proveedor de material de empaque', 'purchases'),
    (6, 'SERVICIOS', 'Servicios / maquila', 'purchases')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.catalogs_zones (order_list, code, name) VALUES
    (1, 'CAPITAL', 'Región Capital'),
    (2, 'CENTRAL', 'Región Central'),
    (3, 'OCCIDENTE', 'Occidente'),
    (4, 'ORIENTE', 'Oriente'),
    (5, 'ANDES', 'Los Andes'),
    (6, 'LLANOS', 'Los Llanos'),
    (7, 'EXTERIOR', 'Exterior')
ON CONFLICT (code) DO NOTHING;
