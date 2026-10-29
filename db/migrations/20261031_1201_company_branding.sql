-- =====================================================================
--  FabriHub · Fase 12 · Identidad de cada empresa
--
--  Logo (cabecera del sitio, reportes Excel, PDF y correos), ícono cuadrado (favicon)
--  y color de marca opcional. Las imágenes viven en files (fase 11).
--  La FK compuesta (id, logo_file_id) → files (company_id, id) garantiza que el
--  archivo pertenezca a la propia empresa.
-- =====================================================================

ALTER TABLE public.companies
    ADD COLUMN logo_file_id UUID,
    ADD COLUMN icon_file_id UUID,
    ADD COLUMN brand_color VARCHAR(7) CHECK (brand_color ~ '^#[0-9a-f]{6}$'),
    ADD CONSTRAINT fk_companies_logo FOREIGN KEY (id, logo_file_id)
        REFERENCES public.files (company_id, id) ON UPDATE NO ACTION ON DELETE SET NULL (logo_file_id),
    ADD CONSTRAINT fk_companies_icon FOREIGN KEY (id, icon_file_id)
        REFERENCES public.files (company_id, id) ON UPDATE NO ACTION ON DELETE SET NULL (icon_file_id);

COMMENT ON COLUMN public.companies.logo_file_id IS 'Logo de la empresa (files.purpose = company_logo): sitio, Excel, PDF y correos';
COMMENT ON COLUMN public.companies.icon_file_id IS 'Ícono cuadrado (files.purpose = company_icon): favicon';
COMMENT ON COLUMN public.companies.brand_color IS 'Color de marca opcional (#rrggbb, minúsculas): acentos del sitio, documentos y correos';
