-- =====================================================================
--  FabriHub · Reportes con resumen, comparación y equivalente en dólares
--
--  fn_rate_on(moneda, fecha): unidades de la moneda BASE de la empresa activa por 1 unidad de la
--  moneda, vigente en esa fecha (la última tasa con rate_date <= fecha). La base vale 1; sin tasa,
--  NULL. Los reportes la usan para expresar montos en USD con la tasa de cada día.
--  Corre con los permisos de quien la llama (SECURITY INVOKER): la RLS acota a la empresa activa.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.fn_rate_on(p_code TEXT, p_date DATE)
RETURNS NUMERIC
LANGUAGE sql
STABLE
AS $$
    SELECT CASE
             WHEN TRIM(c.code) = TRIM(p_code) THEN 1::numeric
             ELSE (SELECT r.rate FROM public.currencies_rates r
                     JOIN public.catalogs_currencies x ON x.id = r.currency_id
                    WHERE TRIM(x.code) = TRIM(p_code) AND r.rate_date <= p_date
                    ORDER BY r.rate_date DESC LIMIT 1)
           END
      FROM public.companies co JOIN public.catalogs_currencies c ON c.id = co.base_currency_id
     WHERE co.id = public.fn_current_company();
$$;
COMMENT ON FUNCTION public.fn_rate_on(TEXT, DATE) IS
    'Unidades de moneda base por 1 unidad de p_code vigentes en p_date (base = 1; sin tasa = NULL)';
