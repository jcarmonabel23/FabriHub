-- =====================================================================
--  FabriHub · Fase 17 · Ticket imprimible del punto de venta
--
--  · pos_terminals: ancho del papel (58/80 mm), copias por impresión, impresión automática al
--    cobrar y un pie de ticket propio de la caja.
--  · pos_sales_prints: cada impresión del ticket. La primera es el ORIGINAL; las siguientes salen
--    marcadas «COPIA» (reimpresión), con quién y cuándo.
--  El ticket se arma en el navegador (CSS de impresión): sirve cualquier impresora térmica instalada.
-- =====================================================================

ALTER TABLE public.pos_terminals
    ADD COLUMN ticket_width_mm SMALLINT NOT NULL DEFAULT 80 CHECK (ticket_width_mm IN (58, 80)),
    ADD COLUMN ticket_copies SMALLINT NOT NULL DEFAULT 1 CHECK (ticket_copies BETWEEN 1 AND 3),
    ADD COLUMN auto_print BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN ticket_footer VARCHAR(300);
COMMENT ON COLUMN public.pos_terminals.ticket_width_mm IS 'Ancho del papel de la impresora térmica: 58 u 80 mm';
COMMENT ON COLUMN public.pos_terminals.ticket_copies IS 'Ejemplares por impresión (1 a 3)';
COMMENT ON COLUMN public.pos_terminals.auto_print IS 'Abrir la impresión del ticket al confirmar la venta';
COMMENT ON COLUMN public.pos_terminals.ticket_footer IS 'Mensaje al pie del ticket (p. ej. política de cambios)';

CREATE TABLE public.pos_sales_prints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL DEFAULT public.fn_current_company()
        CONSTRAINT fk_pos_sales_prints_company REFERENCES public.companies(id) ON DELETE RESTRICT,
    sale_id UUID NOT NULL,
    print_no INTEGER NOT NULL CHECK (print_no >= 1),
    copies SMALLINT NOT NULL DEFAULT 1 CHECK (copies BETWEEN 1 AND 3),
    is_copy BOOLEAN NOT NULL,
    printed_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    printed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_pos_sales_prints_no UNIQUE (company_id, sale_id, print_no),
    CONSTRAINT fk_pos_sales_prints_sale FOREIGN KEY (company_id, sale_id) REFERENCES public.pos_sales (company_id, id) ON DELETE CASCADE
);
COMMENT ON TABLE public.pos_sales_prints IS 'Impresiones del ticket de una venta (la 1 es el original; las demás, copias)';
COMMENT ON COLUMN public.pos_sales_prints.company_id IS 'Empresa dueña del registro (aislada por RLS)';
COMMENT ON COLUMN public.pos_sales_prints.print_no IS 'Número de impresión de la venta (1 = original)';
COMMENT ON COLUMN public.pos_sales_prints.copies IS 'Ejemplares impresos esa vez';
COMMENT ON COLUMN public.pos_sales_prints.is_copy IS 'TRUE = reimpresión (sale marcada COPIA)';
COMMENT ON COLUMN public.pos_sales_prints.printed_by IS 'Usuario que imprimió';
CREATE INDEX idx_pos_sales_prints_company ON public.pos_sales_prints (company_id);

ALTER TABLE public.pos_sales_prints ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_company_isolation ON public.pos_sales_prints
    USING (company_id = (SELECT public.fn_current_company()))
    WITH CHECK (company_id = (SELECT public.fn_current_company()));
CREATE TRIGGER trg_audit_pos_sales_prints AFTER INSERT OR UPDATE OR DELETE ON public.pos_sales_prints
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit();
-- La bitácora de impresiones no se corrige ni se borra
REVOKE UPDATE, DELETE ON public.pos_sales_prints FROM :"app_user";
