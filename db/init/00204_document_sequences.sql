-- =====================================================================
--  FabriHub · 00204_document_sequences.sql
--  Correlativos de documentos (Nº Orden de Compra, Nº Orden de Venta,
--  Nº Orden de Producción, Nº de Mercancía Recibida, Nota de Entrega,
--  Nº de Transacción de inventario). La tesis los describe como "número
--  asignado de acuerdo a la secuencia de ingreso".
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.document_sequences (
    doc_type VARCHAR(10) PRIMARY KEY CHECK (doc_type ~ '^[A-Z]+$'),

    name VARCHAR(80) NOT NULL,
    module_code VARCHAR(40) NOT NULL REFERENCES public.catalogs_modules(code) ON UPDATE CASCADE,
    prefix VARCHAR(10) NOT NULL DEFAULT '' CHECK (prefix ~ '^[A-Z0-9-]*$'),
    padding SMALLINT NOT NULL DEFAULT 6 CHECK (padding BETWEEN 1 AND 12),
    next_number BIGINT NOT NULL DEFAULT 1 CHECK (next_number >= 1),

    updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.document_sequences IS 'Correlativos por tipo de documento; se consumen con fn_next_document_number()';
COMMENT ON COLUMN public.document_sequences.doc_type IS 'Tipo de documento (PO, SO, MO, REC, DN, MOV)';
COMMENT ON COLUMN public.document_sequences.name IS 'Nombre del documento';
COMMENT ON COLUMN public.document_sequences.module_code IS 'Módulo que emite el documento';
COMMENT ON COLUMN public.document_sequences.prefix IS 'Prefijo del número (p. ej. OC-)';
COMMENT ON COLUMN public.document_sequences.padding IS 'Dígitos con ceros a la izquierda';
COMMENT ON COLUMN public.document_sequences.next_number IS 'Próximo número a emitir';
COMMENT ON COLUMN public.document_sequences.updated_by IS 'Usuario que modificó la configuración';
COMMENT ON COLUMN public.document_sequences.updated_at IS 'Fecha de la última modificación';

CREATE TRIGGER trg_document_sequences_updated_at BEFORE UPDATE ON public.document_sequences
    FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

INSERT INTO public.document_sequences (doc_type, name, module_code, prefix) VALUES
    ('PO',  'Orden de compra',           'PURCHASES',  'OC-'),
    ('REC', 'Recepción de mercancía',    'PURCHASES',  'REC-'),
    ('SO',  'Orden de venta',            'SALES',      'OV-'),
    ('DN',  'Nota de entrega',           'SALES',      'NE-'),
    ('MO',  'Orden de producción',       'PRODUCTION', 'OP-'),
    ('MOV', 'Movimiento de inventario',  'INVENTORY',  'MI-')
ON CONFLICT (doc_type) DO NOTHING;

-- ---------------------------------------------------------------------
-- Emite el siguiente número de forma atómica: el UPDATE bloquea la fila,
-- así dos transacciones concurrentes nunca reciben el mismo número.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_next_document_number(p_doc_type VARCHAR)
RETURNS VARCHAR
LANGUAGE plpgsql
AS $$
DECLARE
    v_number BIGINT;
    v_prefix VARCHAR;
    v_padding SMALLINT;
BEGIN
    UPDATE public.document_sequences
       SET next_number = next_number + 1
     WHERE doc_type = p_doc_type
    RETURNING next_number - 1, prefix, padding INTO v_number, v_prefix, v_padding;

    IF v_number IS NULL THEN
        RAISE EXCEPTION 'Tipo de documento sin correlativo: %', p_doc_type USING ERRCODE = 'P0001';
    END IF;

    RETURN v_prefix || lpad(v_number::text, v_padding, '0');
END;
$$;

COMMENT ON FUNCTION public.fn_next_document_number(VARCHAR) IS 'Siguiente número de documento (prefijo + correlativo con ceros), atómico';
