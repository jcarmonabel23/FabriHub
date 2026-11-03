-- =====================================================================
--  FabriHub · Fase 18 · Costa Rica: comprobantes electrónicos v4.4
--
--  · products.cabys_code: código CABYS (13 dígitos) que Hacienda exige en cada línea.
--  · catalogs_units.hacienda_code: unidad de medida de Hacienda (RTC 443) de cada unidad.
--  · pos_terminals: sucursal (3 dígitos) y terminal (5) del consecutivo de Hacienda.
--  · einvoice_settings: configuración por empresa (actividad económica, ubicación del emisor,
--    ambiente de pruebas o producción, contingencia). Las credenciales del ATV (usuario, clave,
--    llave criptográfica .p12 y su PIN) van cifradas en company_secrets; aquí solo sus datos
--    visibles (vencimiento del certificado).
--  · einvoice_sequences: consecutivo por sucursal + terminal + tipo de comprobante.
--  · einvoice_documents: cada comprobante (tiquete, factura o nota de crédito) con su clave de 50
--    dígitos, el XML firmado y la respuesta de Hacienda. Funciona como cola de envío: la API lo
--    firma y lo envía en segundo plano, reintenta y consulta el estado hasta aceptado/rechazado.
--  · Alerta EINV_FAILED: comprobantes rechazados o que no logran enviarse.
-- =====================================================================

-- --------------------------------------------------------------- CABYS por producto
ALTER TABLE public.products ADD COLUMN cabys_code CHAR(13) CHECK (cabys_code ~ '^[0-9]{13}$');
COMMENT ON COLUMN public.products.cabys_code IS 'Código CABYS (Catálogo de Bienes y Servicios de Hacienda, 13 dígitos); obligatorio para emitir comprobantes en Costa Rica';

-- --------------------------------------------------------------- Unidad de medida de Hacienda
ALTER TABLE public.catalogs_units ADD COLUMN hacienda_code VARCHAR(12);
COMMENT ON COLUMN public.catalogs_units.hacienda_code IS 'Unidad de medida de Hacienda de Costa Rica (UnidadMedidaType, RTC 443); NULL = Unid';
UPDATE public.catalogs_units SET hacienda_code = CASE code
    WHEN 'KG' THEN 'Kg' WHEN 'G' THEN 'G' WHEN 'L' THEN 'L' WHEN 'ML' THEN 'mL' WHEN 'H' THEN 'h'
    ELSE 'Unid' END;

-- --------------------------------------------------------------- Sucursal y terminal de cada caja
ALTER TABLE public.pos_terminals
    ADD COLUMN einv_branch SMALLINT NOT NULL DEFAULT 1 CHECK (einv_branch BETWEEN 1 AND 999),
    ADD COLUMN einv_terminal INTEGER NOT NULL DEFAULT 1 CHECK (einv_terminal BETWEEN 1 AND 99999);
COMMENT ON COLUMN public.pos_terminals.einv_branch IS 'Costa Rica: sucursal del consecutivo de Hacienda (001 = casa matriz)';
COMMENT ON COLUMN public.pos_terminals.einv_terminal IS 'Costa Rica: terminal o punto de venta del consecutivo de Hacienda';

-- --------------------------------------------------------------- Configuración por empresa
CREATE TABLE public.einvoice_settings (
    company_id UUID PRIMARY KEY DEFAULT public.fn_current_company() REFERENCES public.companies(id) ON DELETE CASCADE,
    is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    environment VARCHAR(10) NOT NULL DEFAULT 'sandbox' CHECK (environment IN ('sandbox', 'prod')),
    activity_code CHAR(6) CHECK (activity_code ~ '^[0-9]{6}$'),
    provider_id VARCHAR(20),
    province SMALLINT CHECK (province BETWEEN 1 AND 7),
    canton CHAR(2) CHECK (canton ~ '^[0-9]{2}$'),
    district CHAR(2) CHECK (district ~ '^[0-9]{2}$'),
    neighborhood VARCHAR(50),
    other_signs VARCHAR(250),
    service_unit VARCHAR(5) NOT NULL DEFAULT 'Sp' CHECK (service_unit IN ('Sp', 'Spe', 'Os', 'St', 'h')),
    contingency BOOLEAN NOT NULL DEFAULT FALSE,
    idp_url VARCHAR(300),
    api_url VARCHAR(300),
    cert_subject VARCHAR(300),
    cert_expires_at TIMESTAMPTZ,
    updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_einvoice_settings_enabled CHECK (NOT is_enabled OR (activity_code IS NOT NULL AND province IS NOT NULL
        AND canton IS NOT NULL AND district IS NOT NULL AND other_signs IS NOT NULL))
);
COMMENT ON TABLE public.einvoice_settings IS 'Costa Rica: configuración de comprobantes electrónicos de la empresa';
COMMENT ON COLUMN public.einvoice_settings.is_enabled IS 'TRUE = cada venta del POS emite su comprobante electrónico';
COMMENT ON COLUMN public.einvoice_settings.environment IS 'sandbox = ambiente de pruebas de Hacienda; prod = producción';
COMMENT ON COLUMN public.einvoice_settings.activity_code IS 'Código de la actividad económica inscrita (CodigoActividadEmisor, 6 dígitos)';
COMMENT ON COLUMN public.einvoice_settings.provider_id IS 'Cédula del proveedor de sistemas (ProveedorSistemas); NULL = la de la propia empresa';
COMMENT ON COLUMN public.einvoice_settings.province IS 'Ubicación del emisor: provincia (1 a 7)';
COMMENT ON COLUMN public.einvoice_settings.canton IS 'Ubicación del emisor: cantón (2 dígitos)';
COMMENT ON COLUMN public.einvoice_settings.district IS 'Ubicación del emisor: distrito (2 dígitos)';
COMMENT ON COLUMN public.einvoice_settings.neighborhood IS 'Ubicación del emisor: barrio (opcional)';
COMMENT ON COLUMN public.einvoice_settings.other_signs IS 'Ubicación del emisor: otras señas';
COMMENT ON COLUMN public.einvoice_settings.service_unit IS 'Unidad de Hacienda de las líneas de servicio (productos no inventariables)';
COMMENT ON COLUMN public.einvoice_settings.contingency IS 'Modo contingencia: los comprobantes se emiten con situación 3 (sin internet) y se envían al volver';
COMMENT ON COLUMN public.einvoice_settings.idp_url IS 'Solo fuera de producción: URL simulada del IdP (pruebas de humo)';
COMMENT ON COLUMN public.einvoice_settings.api_url IS 'Solo fuera de producción: URL simulada de la API de recepción (pruebas de humo)';
COMMENT ON COLUMN public.einvoice_settings.cert_subject IS 'Titular del certificado de la llave criptográfica cargada';
COMMENT ON COLUMN public.einvoice_settings.cert_expires_at IS 'Vencimiento del certificado de la llave criptográfica';

-- --------------------------------------------------------------- Consecutivos
CREATE TABLE public.einvoice_sequences (
    company_id UUID NOT NULL DEFAULT public.fn_current_company() REFERENCES public.companies(id) ON DELETE CASCADE,
    branch SMALLINT NOT NULL,
    terminal INTEGER NOT NULL,
    doc_type VARCHAR(2) NOT NULL CHECK (doc_type IN ('FE', 'TE', 'NC')),
    next_number BIGINT NOT NULL DEFAULT 1 CHECK (next_number BETWEEN 1 AND 9999999999),
    PRIMARY KEY (company_id, branch, terminal, doc_type)
);
COMMENT ON TABLE public.einvoice_sequences IS 'Costa Rica: siguiente número del consecutivo por sucursal, terminal y tipo de comprobante';

-- --------------------------------------------------------------- Comprobantes
CREATE TABLE public.einvoice_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL DEFAULT public.fn_current_company()
        CONSTRAINT fk_einvoice_documents_company REFERENCES public.companies(id) ON DELETE RESTRICT,
    doc_type VARCHAR(2) NOT NULL CHECK (doc_type IN ('FE', 'TE', 'NC')),
    sale_id UUID NOT NULL,
    reference_id UUID,
    clave CHAR(50) NOT NULL CHECK (clave ~ '^[0-9]{50}$'),
    consecutive CHAR(20) NOT NULL CHECK (consecutive ~ '^[0-9]{20}$'),
    situation CHAR(1) NOT NULL DEFAULT '1' CHECK (situation IN ('1', '2', '3')),
    environment VARCHAR(10) NOT NULL CHECK (environment IN ('sandbox', 'prod')),
    issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    total NUMERIC(20, 2) NOT NULL,
    reason VARCHAR(180),
    status VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'accepted', 'rejected', 'cancelled')),
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_error VARCHAR(1000),
    signed_xml TEXT,
    response_xml TEXT,
    response_message VARCHAR(4000),
    sent_at TIMESTAMPTZ,
    decided_at TIMESTAMPTZ,
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_einvoice_documents_company_id UNIQUE (company_id, id),
    CONSTRAINT uq_einvoice_documents_clave UNIQUE (clave),
    CONSTRAINT uq_einvoice_documents_sale UNIQUE (company_id, sale_id, doc_type),
    CONSTRAINT fk_einvoice_documents_sale FOREIGN KEY (company_id, sale_id) REFERENCES public.pos_sales (company_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_einvoice_documents_reference FOREIGN KEY (company_id, reference_id)
        REFERENCES public.einvoice_documents (company_id, id) ON DELETE RESTRICT,
    CONSTRAINT ck_einvoice_documents_reference CHECK ((doc_type = 'NC') = (reference_id IS NOT NULL))
);
COMMENT ON TABLE public.einvoice_documents IS 'Costa Rica: comprobantes electrónicos emitidos y su cola de envío a Hacienda';
COMMENT ON COLUMN public.einvoice_documents.company_id IS 'Empresa dueña del registro (aislada por RLS)';
COMMENT ON COLUMN public.einvoice_documents.doc_type IS 'FE = factura electrónica, TE = tiquete electrónico, NC = nota de crédito electrónica';
COMMENT ON COLUMN public.einvoice_documents.sale_id IS 'Venta del POS que lo originó';
COMMENT ON COLUMN public.einvoice_documents.reference_id IS 'Nota de crédito: comprobante que anula';
COMMENT ON COLUMN public.einvoice_documents.clave IS 'Clave numérica de 50 dígitos (país, fecha, cédula, consecutivo, situación y código de seguridad)';
COMMENT ON COLUMN public.einvoice_documents.consecutive IS 'Consecutivo de 20 dígitos (sucursal, terminal, tipo y número)';
COMMENT ON COLUMN public.einvoice_documents.situation IS '1 = normal, 2 = contingencia, 3 = sin internet';
COMMENT ON COLUMN public.einvoice_documents.environment IS 'Ambiente de Hacienda al que se envía';
COMMENT ON COLUMN public.einvoice_documents.reason IS 'Nota de crédito: razón de la referencia (motivo de la anulación)';
COMMENT ON COLUMN public.einvoice_documents.status IS 'pending = por enviar, sent = recibido por Hacienda (procesando), accepted, rejected, cancelled = no se envía (su comprobante de referencia fue rechazado)';
COMMENT ON COLUMN public.einvoice_documents.attempts IS 'Intentos de envío o de consulta realizados';
COMMENT ON COLUMN public.einvoice_documents.next_attempt_at IS 'Cuándo la cola vuelve a intentarlo';
COMMENT ON COLUMN public.einvoice_documents.last_error IS 'Último error de firma, autenticación o envío';
COMMENT ON COLUMN public.einvoice_documents.signed_xml IS 'XML 4.4 firmado (XAdES-EPES) tal como se envió';
COMMENT ON COLUMN public.einvoice_documents.response_xml IS 'MensajeHacienda devuelto (XML)';
COMMENT ON COLUMN public.einvoice_documents.response_message IS 'Detalle del mensaje de Hacienda (motivo del rechazo)';
CREATE INDEX idx_einvoice_documents_queue ON public.einvoice_documents (company_id, next_attempt_at) WHERE status IN ('pending', 'sent');
CREATE INDEX idx_einvoice_documents_sale ON public.einvoice_documents (sale_id);

DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['einvoice_settings', 'einvoice_sequences', 'einvoice_documents'] LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('CREATE POLICY p_company_isolation ON public.%I
                          USING (company_id = (SELECT public.fn_current_company()))
                          WITH CHECK (company_id = (SELECT public.fn_current_company()))', t);
    END LOOP;
END
$$;
CREATE TRIGGER trg_audit_einvoice_settings AFTER INSERT OR UPDATE OR DELETE ON public.einvoice_settings
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit();
-- Los comprobantes no se auditan fila a fila (llevan el XML completo): la tabla ya es su propia bitácora
REVOKE DELETE ON public.einvoice_documents FROM :"app_user";
REVOKE DELETE ON public.einvoice_sequences FROM :"app_user";

-- --------------------------------------------------------------- Alerta
ALTER TABLE public.alerts DROP CONSTRAINT alerts_kind_check;
ALTER TABLE public.alerts ADD CONSTRAINT alerts_kind_check CHECK (kind IN ('STOCK_MIN', 'STOCK_MAX', 'LOT_EXPIRING', 'LOT_EXPIRED',
    'QC_PENDING', 'PO_OVERDUE', 'PRO_LATE', 'SO_LATE', 'RATES_FAILED', 'EINV_FAILED'));
