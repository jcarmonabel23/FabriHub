-- =====================================================================
--  FabriHub · Fase 11 · Archivos e imagen de producto
--
--  · files: metadatos de cada archivo subido (el contenido vive en el almacenamiento:
--    volumen `uploads` o, más adelante, un bucket S3/R2). Es por empresa (RLS).
--    Solo imágenes PNG/JPG/WebP, re-codificadas a WebP por la API (sin EXIF ni
--    contenido incrustado), con miniaturas de 96 y 400 px.
--  · products.image_file_id: imagen del producto (al borrar el archivo queda NULL).
--  · products.barcode: código de barras, único por empresa.
-- =====================================================================

CREATE TABLE public.files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL DEFAULT public.fn_current_company()
        CONSTRAINT fk_files_company REFERENCES public.companies(id) ON DELETE RESTRICT,

    purpose VARCHAR(30) NOT NULL
        CHECK (purpose IN ('product_image', 'company_logo', 'company_logo_dark', 'company_icon')),
    storage_key VARCHAR(300) NOT NULL,
    mime_type VARCHAR(60) NOT NULL CHECK (mime_type IN ('image/webp')),
    size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
    width INTEGER NOT NULL CHECK (width > 0),
    height INTEGER NOT NULL CHECK (height > 0),
    variants TEXT[] NOT NULL DEFAULT '{}',
    sha256 CHAR(64) NOT NULL,
    original_name VARCHAR(200),
    original_mime VARCHAR(60) NOT NULL,
    original_bytes INTEGER NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by VARCHAR(100),

    CONSTRAINT uq_files_company_id UNIQUE (company_id, id),
    CONSTRAINT uq_files_storage_key UNIQUE (storage_key)
);

COMMENT ON TABLE public.files IS 'Archivos subidos (metadatos). El contenido está en el almacenamiento (volumen uploads / S3)';
COMMENT ON COLUMN public.files.company_id IS 'Empresa dueña del registro (aislada por RLS)';
COMMENT ON COLUMN public.files.purpose IS 'Uso del archivo: decide quién puede verlo y reemplazarlo';
COMMENT ON COLUMN public.files.storage_key IS 'Prefijo de la clave en el almacenamiento: <empresa>/<archivo>; cada variante es <prefijo>/<variante>.webp';
COMMENT ON COLUMN public.files.variants IS 'Variantes generadas (orig, 400, 96)';
COMMENT ON COLUMN public.files.sha256 IS 'Hash del archivo tal como se subió';

CREATE INDEX idx_files_company ON public.files (company_id);

ALTER TABLE public.files ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_company_isolation ON public.files
    USING (company_id = (SELECT public.fn_current_company()))
    WITH CHECK (company_id = (SELECT public.fn_current_company()));

CREATE TRIGGER trg_audit_files AFTER INSERT OR UPDATE OR DELETE ON public.files
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit();

-- Los archivos no se editan: se suben y se borran
REVOKE UPDATE ON public.files FROM :"app_user";

-- --------------------------------------------------------------- Productos
ALTER TABLE public.products
    ADD COLUMN image_file_id UUID,
    ADD COLUMN barcode VARCHAR(64) CHECK (barcode ~ '^[0-9A-Za-z.\-]{3,64}$'),
    ADD CONSTRAINT fk_products_image FOREIGN KEY (company_id, image_file_id)
        REFERENCES public.files (company_id, id) ON UPDATE NO ACTION ON DELETE SET NULL (image_file_id);

CREATE UNIQUE INDEX uq_products_barcode ON public.products (company_id, barcode) WHERE barcode IS NOT NULL;
CREATE INDEX idx_products_image ON public.products (image_file_id) WHERE image_file_id IS NOT NULL;

COMMENT ON COLUMN public.products.image_file_id IS 'Imagen del producto (files.purpose = product_image)';
COMMENT ON COLUMN public.products.barcode IS 'Código de barras (EAN/UPC u otro), único por empresa';
