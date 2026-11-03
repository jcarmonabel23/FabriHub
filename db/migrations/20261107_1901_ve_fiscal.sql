-- =====================================================================
--  FabriHub · Fase 19 · Venezuela: documento fiscal del punto de venta
--
--  Cada caja elige su emisor fiscal (interfaz FiscalIssuer de la API):
--    · none     = comprobante no fiscal (como hasta ahora);
--    · printer  = impresora fiscal homologada. El servidor no llega al puerto serie de la caja: un
--                 agente local en esa PC (protocolo propio, ver scripts/fiscal-sim) recibe la venta
--                 desde el navegador, la imprime y devuelve el número de factura, el serial de la
--                 máquina y el contador Z;
--    · digital  = imprenta digital autorizada. La API envía el documento al proveedor (adaptador
--                 genérico), que asigna el número de control y devuelve el PDF.
--  · fiscal_settings: proveedor de imprenta digital de la empresa (URL, ambiente, contingencia).
--    Su clave de API va cifrada en company_secrets.
--  · fiscal_documents: factura o nota de crédito fiscal de cada venta; también es la cola (impresión
--    pendiente en la caja o envío pendiente al proveedor). Contingencia: el cajero emite el formato
--    físico y registra su número; con imprenta digital se transmite después (registro posterior).
--  · fiscal_z_reports: reportes Z (cierre diario) que devuelve la impresora fiscal.
--  · Alerta FISCAL_PENDING: documentos que no logran emitirse.
-- =====================================================================

-- --------------------------------------------------------------- Característica del país
UPDATE public.catalogs_countries SET features = features || '{"fiscalDoc":true}' WHERE code = 'VE';
UPDATE public.catalogs_countries SET features = features || '{"fiscalDoc":false}' WHERE code <> 'VE';
COMMENT ON COLUMN public.catalogs_countries.features IS 'Qué aplica en el país: igtf, withholdings, specialTaxpayer, eInvoice, fiscalDoc';

-- --------------------------------------------------------------- Emisor fiscal de cada caja
ALTER TABLE public.pos_terminals
    ADD COLUMN fiscal_mode VARCHAR(10) NOT NULL DEFAULT 'none' CHECK (fiscal_mode IN ('none', 'printer', 'digital')),
    ADD COLUMN fiscal_agent_url VARCHAR(300),
    ADD COLUMN fiscal_serial VARCHAR(30);
COMMENT ON COLUMN public.pos_terminals.fiscal_mode IS 'Venezuela: emisor fiscal de la caja (none = no fiscal, printer = impresora fiscal, digital = imprenta digital)';
COMMENT ON COLUMN public.pos_terminals.fiscal_agent_url IS 'Impresora fiscal: URL del agente local en la PC de la caja (NULL = http://127.0.0.1:7788)';
COMMENT ON COLUMN public.pos_terminals.fiscal_serial IS 'Impresora fiscal: serial registrado de la máquina; si se indica, el agente debe reportar el mismo';

-- --------------------------------------------------------------- Imprenta digital de la empresa
CREATE TABLE public.fiscal_settings (
    company_id UUID PRIMARY KEY DEFAULT public.fn_current_company() REFERENCES public.companies(id) ON DELETE CASCADE,
    digital_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    provider_name VARCHAR(120),
    environment VARCHAR(10) NOT NULL DEFAULT 'test' CHECK (environment IN ('test', 'prod')),
    api_url VARCHAR(300),
    series VARCHAR(10),
    contingency BOOLEAN NOT NULL DEFAULT FALSE,
    updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_fiscal_settings_enabled CHECK (NOT digital_enabled OR (provider_name IS NOT NULL AND api_url IS NOT NULL))
);
COMMENT ON TABLE public.fiscal_settings IS 'Venezuela: proveedor de imprenta digital de la empresa (la clave de API va cifrada en company_secrets)';
COMMENT ON COLUMN public.fiscal_settings.digital_enabled IS 'TRUE = las cajas en modo imprenta digital emiten con este proveedor';
COMMENT ON COLUMN public.fiscal_settings.provider_name IS 'Nombre de la imprenta digital autorizada por el SENIAT';
COMMENT ON COLUMN public.fiscal_settings.environment IS 'test = ambiente de pruebas del proveedor; prod = producción';
COMMENT ON COLUMN public.fiscal_settings.api_url IS 'URL base de la API del proveedor (adaptador genérico)';
COMMENT ON COLUMN public.fiscal_settings.series IS 'Serie de los documentos asignada por el proveedor (opcional)';
COMMENT ON COLUMN public.fiscal_settings.contingency IS 'Contingencia: no se envía al proveedor; se emite el formato físico y se registra después';

-- --------------------------------------------------------------- Documentos fiscales
CREATE TABLE public.fiscal_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL DEFAULT public.fn_current_company()
        CONSTRAINT fk_fiscal_documents_company REFERENCES public.companies(id) ON DELETE RESTRICT,
    doc_type VARCHAR(3) NOT NULL CHECK (doc_type IN ('FAC', 'NC')),
    issuer VARCHAR(10) NOT NULL CHECK (issuer IN ('printer', 'digital')),
    sale_id UUID NOT NULL,
    terminal_id UUID NOT NULL,
    reference_id UUID,
    total NUMERIC(20, 2) NOT NULL,
    igtf_amount NUMERIC(20, 2) NOT NULL DEFAULT 0,
    reason VARCHAR(180),
    status VARCHAR(12) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'issued', 'contingency', 'cancelled')),
    document_number VARCHAR(30),
    control_number VARCHAR(30),
    machine_serial VARCHAR(30),
    z_number INTEGER,
    issued_at TIMESTAMPTZ,
    contingency_form VARCHAR(30),
    contingency_at TIMESTAMPTZ,
    contingency_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    registered_at TIMESTAMPTZ,
    pdf BYTEA,
    pdf_url VARCHAR(500),
    provider_response JSONB,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_error VARCHAR(1000),
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_fiscal_documents_company_id UNIQUE (company_id, id),
    CONSTRAINT uq_fiscal_documents_sale UNIQUE (company_id, sale_id, doc_type),
    CONSTRAINT fk_fiscal_documents_sale FOREIGN KEY (company_id, sale_id) REFERENCES public.pos_sales (company_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_fiscal_documents_terminal FOREIGN KEY (company_id, terminal_id) REFERENCES public.pos_terminals (company_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_fiscal_documents_reference FOREIGN KEY (company_id, reference_id)
        REFERENCES public.fiscal_documents (company_id, id) ON DELETE RESTRICT,
    CONSTRAINT ck_fiscal_documents_reference CHECK ((doc_type = 'NC') = (reference_id IS NOT NULL)),
    CONSTRAINT ck_fiscal_documents_issued CHECK (status <> 'issued' OR document_number IS NOT NULL OR control_number IS NOT NULL),
    CONSTRAINT ck_fiscal_documents_contingency CHECK (status <> 'contingency' OR contingency_form IS NOT NULL)
);
COMMENT ON TABLE public.fiscal_documents IS 'Venezuela: factura o nota de crédito fiscal de cada venta del POS y su cola de emisión';
COMMENT ON COLUMN public.fiscal_documents.company_id IS 'Empresa dueña del registro (aislada por RLS)';
COMMENT ON COLUMN public.fiscal_documents.doc_type IS 'FAC = factura, NC = nota de crédito (anula la factura de la venta)';
COMMENT ON COLUMN public.fiscal_documents.issuer IS 'printer = impresora fiscal (vía agente local), digital = imprenta digital';
COMMENT ON COLUMN public.fiscal_documents.terminal_id IS 'Caja cuya impresora o configuración emite el documento';
COMMENT ON COLUMN public.fiscal_documents.reference_id IS 'Nota de crédito: factura que anula';
COMMENT ON COLUMN public.fiscal_documents.igtf_amount IS 'IGTF percibido en la venta (se mantiene en el documento)';
COMMENT ON COLUMN public.fiscal_documents.status IS 'pending = por emitir, issued = emitido, contingency = formato físico (imprenta digital: por registrar), cancelled = no se emitió (venta anulada antes)';
COMMENT ON COLUMN public.fiscal_documents.document_number IS 'Número de la factura o nota de crédito (impresora fiscal o imprenta digital)';
COMMENT ON COLUMN public.fiscal_documents.control_number IS 'Imprenta digital: número de control asignado por el proveedor';
COMMENT ON COLUMN public.fiscal_documents.machine_serial IS 'Impresora fiscal: serial de la máquina que lo imprimió';
COMMENT ON COLUMN public.fiscal_documents.z_number IS 'Impresora fiscal: número del reporte Z del día en que se imprimió';
COMMENT ON COLUMN public.fiscal_documents.contingency_form IS 'Contingencia: número de control del formato físico emitido';
COMMENT ON COLUMN public.fiscal_documents.registered_at IS 'Imprenta digital: cuándo se registró un documento emitido en contingencia';
COMMENT ON COLUMN public.fiscal_documents.pdf IS 'Imprenta digital: PDF del documento devuelto por el proveedor';
COMMENT ON COLUMN public.fiscal_documents.pdf_url IS 'Imprenta digital: enlace al PDF cuando el proveedor no lo entrega en la respuesta';
COMMENT ON COLUMN public.fiscal_documents.provider_response IS 'Respuesta del agente o del proveedor (sin el PDF)';
COMMENT ON COLUMN public.fiscal_documents.next_attempt_at IS 'Imprenta digital: cuándo la cola vuelve a intentarlo';
COMMENT ON COLUMN public.fiscal_documents.last_error IS 'Último error del agente o del proveedor';
CREATE INDEX idx_fiscal_documents_queue ON public.fiscal_documents (company_id, next_attempt_at) WHERE status IN ('pending', 'contingency');
CREATE INDEX idx_fiscal_documents_terminal ON public.fiscal_documents (terminal_id) WHERE status = 'pending';
CREATE INDEX idx_fiscal_documents_sale ON public.fiscal_documents (sale_id);

-- --------------------------------------------------------------- Reportes Z
CREATE TABLE public.fiscal_z_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL DEFAULT public.fn_current_company() REFERENCES public.companies(id) ON DELETE RESTRICT,
    terminal_id UUID NOT NULL,
    session_id UUID,
    machine_serial VARCHAR(30) NOT NULL,
    z_number INTEGER NOT NULL CHECK (z_number > 0),
    report_date DATE NOT NULL,
    first_invoice VARCHAR(30),
    last_invoice VARCHAR(30),
    last_credit_note VARCHAR(30),
    invoices_count INTEGER NOT NULL DEFAULT 0,
    credit_notes_count INTEGER NOT NULL DEFAULT 0,
    totals JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(totals) = 'object'),
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_fiscal_z_reports UNIQUE (company_id, machine_serial, z_number),
    CONSTRAINT fk_fiscal_z_reports_terminal FOREIGN KEY (company_id, terminal_id) REFERENCES public.pos_terminals (company_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_fiscal_z_reports_session FOREIGN KEY (company_id, session_id) REFERENCES public.pos_sessions (company_id, id) ON DELETE RESTRICT
);
COMMENT ON TABLE public.fiscal_z_reports IS 'Venezuela: reportes Z (cierre diario de la memoria fiscal) devueltos por la impresora fiscal de cada caja';
COMMENT ON COLUMN public.fiscal_z_reports.totals IS 'Totales del reporte: ventas, bases e impuestos por alícuota, notas de crédito e IGTF';

DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['fiscal_settings', 'fiscal_documents', 'fiscal_z_reports'] LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('CREATE POLICY p_company_isolation ON public.%I
                          USING (company_id = (SELECT public.fn_current_company()))
                          WITH CHECK (company_id = (SELECT public.fn_current_company()))', t);
    END LOOP;
END
$$;
CREATE TRIGGER trg_audit_fiscal_settings AFTER INSERT OR UPDATE OR DELETE ON public.fiscal_settings
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit();
-- Los documentos y reportes no se borran: son el respaldo de la numeración fiscal
REVOKE DELETE ON public.fiscal_documents FROM :"app_user";
REVOKE DELETE, UPDATE ON public.fiscal_z_reports FROM :"app_user";

-- --------------------------------------------------------------- Alerta
ALTER TABLE public.alerts DROP CONSTRAINT alerts_kind_check;
ALTER TABLE public.alerts ADD CONSTRAINT alerts_kind_check CHECK (kind IN ('STOCK_MIN', 'STOCK_MAX', 'LOT_EXPIRING', 'LOT_EXPIRED',
    'QC_PENDING', 'PO_OVERDUE', 'PRO_LATE', 'SO_LATE', 'RATES_FAILED', 'EINV_FAILED', 'FISCAL_PENDING'));
