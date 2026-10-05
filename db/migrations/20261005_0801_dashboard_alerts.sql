-- =====================================================================
--  FabriHub · 20261005_0801_dashboard_alerts.sql   (fase 8 · Tablero y alertas)
--  Justificación de la tesis (1.2): avisar a tiempo de existencias bajo el
--  mínimo, lotes por vencer, compras y producción atrasadas.
--
--  Flujo:  job cada N minutos ──detecta──▶ alerts (una fila por situación abierta)
--          alerta NUEVA ──▶ notifications (campana de cada destinatario) + correo resumen
--          situación que desaparece ──▶ alerts.resolved_at
--
--  Destinatarios = usuarios con `view` en el módulo de la alerta, respetando el
--  alcance de datos: almacén (users_warehouses) o dueño del documento, salvo `view_all`.
-- =====================================================================

-- --------------------------------------------------------------- Alertas
CREATE TABLE public.alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    alert_key VARCHAR(200) NOT NULL,
    kind VARCHAR(20) NOT NULL CHECK (kind IN ('STOCK_MIN', 'STOCK_MAX', 'LOT_EXPIRING', 'LOT_EXPIRED', 'QC_PENDING',
                                              'PO_OVERDUE', 'PRO_LATE', 'SO_LATE')),
    severity VARCHAR(10) NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
    module_code VARCHAR(40) NOT NULL REFERENCES public.catalogs_modules(code) ON UPDATE CASCADE,
    title VARCHAR(200) NOT NULL,
    message VARCHAR(600) NOT NULL,
    link VARCHAR(200),
    source_id UUID,
    warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE CASCADE,
    owner_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    data JSONB NOT NULL DEFAULT '{}',
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ
);

COMMENT ON TABLE public.alerts IS 'Alarmas del sistema (tesis 1.2): una fila por situación detectada, abierta hasta que deja de cumplirse';
COMMENT ON COLUMN public.alerts.id IS 'Identificador único de la alerta';
COMMENT ON COLUMN public.alerts.alert_key IS 'Clave estable de la situación (tipo + documento/almacén/producto): evita duplicar la alerta en cada corrida';
COMMENT ON COLUMN public.alerts.kind IS 'STOCK_MIN, STOCK_MAX, LOT_EXPIRING, LOT_EXPIRED, QC_PENDING, PO_OVERDUE, PRO_LATE o SO_LATE';
COMMENT ON COLUMN public.alerts.severity IS 'info, warning o critical (puede cambiar mientras está abierta, p. ej. un lote que se acerca al vencimiento)';
COMMENT ON COLUMN public.alerts.module_code IS 'Módulo dueño de la información: decide quién la ve (permiso view)';
COMMENT ON COLUMN public.alerts.title IS 'Título corto (campana y correo)';
COMMENT ON COLUMN public.alerts.message IS 'Detalle legible de la situación';
COMMENT ON COLUMN public.alerts.link IS 'Ruta del front donde se atiende';
COMMENT ON COLUMN public.alerts.source_id IS 'Documento, lote o producto que la origina';
COMMENT ON COLUMN public.alerts.warehouse_id IS 'Almacén afectado: sin view_all solo la ven quienes lo tienen asignado';
COMMENT ON COLUMN public.alerts.owner_id IS 'Dueño del documento: sin view_all solo la ve él (órdenes de venta)';
COMMENT ON COLUMN public.alerts.data IS 'Valores que la originan (cantidades, fechas, días) para el tablero y los reportes';
COMMENT ON COLUMN public.alerts.first_seen_at IS 'Primera corrida que la detectó';
COMMENT ON COLUMN public.alerts.last_seen_at IS 'Última corrida que la vio vigente';
COMMENT ON COLUMN public.alerts.resolved_at IS 'Corrida en que dejó de cumplirse (NULL = abierta)';

CREATE UNIQUE INDEX uq_alerts_open_key ON public.alerts (alert_key) WHERE resolved_at IS NULL;
CREATE INDEX idx_alerts_open ON public.alerts (module_code, severity) WHERE resolved_at IS NULL;
CREATE INDEX idx_alerts_resolved ON public.alerts (resolved_at DESC) WHERE resolved_at IS NOT NULL;

-- --------------------------------------------------------------- Corridas del job
CREATE TABLE public.alerts_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trigger VARCHAR(10) NOT NULL CHECK (trigger IN ('schedule', 'manual')),
    run_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ,
    open_alerts INTEGER NOT NULL DEFAULT 0,
    new_alerts INTEGER NOT NULL DEFAULT 0,
    resolved_alerts INTEGER NOT NULL DEFAULT 0,
    notifications INTEGER NOT NULL DEFAULT 0,
    emails INTEGER NOT NULL DEFAULT 0,
    error VARCHAR(800)
);

COMMENT ON TABLE public.alerts_runs IS 'Bitácora de cada corrida del detector de alertas (programada o manual)';
COMMENT ON COLUMN public.alerts_runs.id IS 'Identificador único de la corrida';
COMMENT ON COLUMN public.alerts_runs.trigger IS 'schedule (job periódico) o manual (botón «Revisar ahora»)';
COMMENT ON COLUMN public.alerts_runs.run_by IS 'Usuario que la lanzó (solo manual)';
COMMENT ON COLUMN public.alerts_runs.started_at IS 'Inicio de la corrida';
COMMENT ON COLUMN public.alerts_runs.finished_at IS 'Fin de la corrida (NULL = en curso o interrumpida)';
COMMENT ON COLUMN public.alerts_runs.open_alerts IS 'Alertas abiertas al terminar';
COMMENT ON COLUMN public.alerts_runs.new_alerts IS 'Alertas detectadas por primera vez';
COMMENT ON COLUMN public.alerts_runs.resolved_alerts IS 'Alertas que dejaron de cumplirse';
COMMENT ON COLUMN public.alerts_runs.notifications IS 'Notificaciones creadas (campana)';
COMMENT ON COLUMN public.alerts_runs.emails IS 'Correos de resumen enviados';
COMMENT ON COLUMN public.alerts_runs.error IS 'Mensaje si la corrida falló';

CREATE INDEX idx_alerts_runs_started ON public.alerts_runs (started_at DESC);

-- --------------------------------------------------------------- Notificaciones (campana)
CREATE TABLE public.notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    alert_id UUID REFERENCES public.alerts(id) ON DELETE SET NULL,
    kind VARCHAR(20) NOT NULL,
    severity VARCHAR(10) NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
    title VARCHAR(200) NOT NULL,
    message VARCHAR(600) NOT NULL,
    link VARCHAR(200),
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    read_at TIMESTAMPTZ,
    emailed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_notifications_user_alert UNIQUE (user_id, alert_id)
);

COMMENT ON TABLE public.notifications IS 'Avisos por usuario (campana del header). Se crean cuando aparece una alerta nueva';
COMMENT ON COLUMN public.notifications.id IS 'Identificador único de la notificación';
COMMENT ON COLUMN public.notifications.user_id IS 'Destinatario';
COMMENT ON COLUMN public.notifications.alert_id IS 'Alerta que la originó';
COMMENT ON COLUMN public.notifications.kind IS 'Tipo de alerta (copia, para filtrar aunque la alerta se depure)';
COMMENT ON COLUMN public.notifications.severity IS 'Severidad al momento de notificar';
COMMENT ON COLUMN public.notifications.title IS 'Título mostrado en la campana';
COMMENT ON COLUMN public.notifications.message IS 'Detalle mostrado en la campana';
COMMENT ON COLUMN public.notifications.link IS 'Ruta del front a la que lleva';
COMMENT ON COLUMN public.notifications.is_read IS 'Leída por el usuario';
COMMENT ON COLUMN public.notifications.read_at IS 'Fecha de lectura';
COMMENT ON COLUMN public.notifications.emailed_at IS 'Fecha en que se incluyó en un correo de resumen';
COMMENT ON COLUMN public.notifications.created_at IS 'Fecha de creación';

CREATE INDEX idx_notifications_user ON public.notifications (user_id, is_read, created_at DESC);

-- Las corridas son bitácora: la app las inserta y cierra, nunca las borra.
REVOKE DELETE, TRUNCATE ON public.alerts_runs FROM :"app_user";
REVOKE TRUNCATE ON public.alerts, public.notifications FROM :"app_user";

-- --------------------------------------------------------------- Parámetros del Tablero
INSERT INTO public.parameters (module_code, order_list, key, name, description, data_type, value, default_value, rules) VALUES
    ('DASHBOARD', 1, 'alerts_enabled', 'Detector de alertas activo',
        'Si está apagado, el job periódico no corre (la revisión manual sigue disponible).', 'boolean', 'true', 'true', '{}'),
    ('DASHBOARD', 2, 'alerts_interval_minutes', 'Frecuencia del detector (minutos)',
        'Cada cuánto se revisan existencias, lotes y documentos atrasados.', 'integer', '60', '60', '{"min":5,"max":1440}'),
    ('DASHBOARD', 3, 'alerts_email', 'Enviar resumen por correo',
        'Cada destinatario recibe un correo con las alertas nuevas de la corrida.', 'boolean', 'true', 'true', '{}'),
    ('DASHBOARD', 4, 'qc_pending_alert_days', 'Cuarentena prolongada (días)',
        'Alerta cuando un lote lleva más de estos días esperando la decisión de Calidad.', 'integer', '7', '7', '{"min":1,"max":120}'),
    ('DASHBOARD', 5, 'notifications_retention_days', 'Conservar notificaciones leídas (días)',
        'Las notificaciones leídas más antiguas se depuran en cada corrida.', 'integer', '90', '90', '{"min":7,"max":730}')
ON CONFLICT (module_code, key) DO NOTHING;

-- --------------------------------------------------------------- Pantallas del Tablero (activas: fase 8)
INSERT INTO public.catalogs_modules (order_list, code, name, description, icon, path, is_offline, metadata, module_parent_id)
SELECT h.order_list, h.code, h.name, h.description, h.icon, h.path, FALSE, '{"phase":8}'::jsonb, p.id
FROM (VALUES
    (1, 'DSH_INDICATORS', 'Indicadores', 'KPIs de inventario, producción, compras, ventas y calidad.', 'chart-bar',        '/dashboard/indicators'),
    (2, 'DSH_ALERTS',     'Alertas',     'Alarmas abiertas, historial y corridas del detector.',       'bell-ringing',     '/dashboard/alerts'),
    (3, 'DSH_REPORTS',    'Reportes',    'Reportes gerenciales en Excel.',                             'file-spreadsheet', '/dashboard/reports')
) AS h(order_list, code, name, description, icon, path)
JOIN public.catalogs_modules p ON p.code = 'DASHBOARD'
ON CONFLICT (code) DO NOTHING;

UPDATE public.catalogs_modules SET metadata = metadata || '{"phase":8}'::jsonb WHERE code = 'DASHBOARD';
