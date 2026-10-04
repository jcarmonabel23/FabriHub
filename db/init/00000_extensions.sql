-- =====================================================================
--  FabriHub · 00000_extensions.sql
--  Extensiones base. Los archivos de db/init se ejecutan en orden
--  alfabético SOLO en el primer arranque (volumen pg_data vacío).
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;     -- emails sin distinción de mayúsculas
