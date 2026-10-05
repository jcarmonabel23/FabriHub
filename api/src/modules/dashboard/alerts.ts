/**
 * @project FabriHub - API
 * @file src/modules/dashboard/alerts.ts
 * @description Detector de alertas (tesis 1.2: alarmas) y pantalla de Alertas (DSH_ALERTS)
 *
 * @overview
 * Una corrida (cada DASHBOARD.alerts_interval_minutes, o manual):
 *  1. Detecta las situaciones vigentes con una consulta por tipo:
 *     STOCK_MIN/STOCK_MAX (políticas por almacén) · LOT_EXPIRING/LOT_EXPIRED · QC_PENDING (cuarentena
 *     prolongada) · PO_OVERDUE (OC sin recibir a la fecha esperada) · PRO_LATE (OP sin terminar a su fin
 *     planificado) · SO_LATE (OV sin despachar a la fecha pedida).
 *  2. Concilia contra `alerts` por clave estable: la que sigue se actualiza (severidad, cantidades),
 *     la nueva se inserta y la que ya no aparece se marca resuelta. Una situación produce UNA alerta,
 *     no una por corrida.
 *  3. Solo las alertas NUEVAS generan notificaciones, para cada usuario que puede verlas
 *     (`alertVisibleTo`), y un correo de resumen por destinatario (DASHBOARD.alerts_email).
 * Un candado de transacción (pg_try_advisory_xact_lock) impide dos corridas a la vez.
 */

import { z } from "zod";
import { one, pool, query, withTx } from "../../db.js";
import { conflict, handler, pageQuery } from "../../lib/http.js";
import { logger } from "../../lib/logger.js";
import { sendAlertDigest } from "../../lib/mailer.js";
import { authOf } from "../../security/context.js";
import { alertVisibleTo } from "./access.js";

export const ALERT_KINDS = ["STOCK_MIN", "STOCK_MAX", "LOT_EXPIRING", "LOT_EXPIRED", "QC_PENDING", "PO_OVERDUE", "PRO_LATE", "SO_LATE"] as const;
type Kind = (typeof ALERT_KINDS)[number];
type Severity = "info" | "warning" | "critical";

interface Candidate {
  key: string;
  kind: Kind;
  severity: Severity;
  module: string;
  title: string;
  message: string;
  link: string;
  source_id: string | null;
  warehouse_id: string | null;
  owner_id: string | null;
  data: Record<string, unknown>;
}

const LOCK_KEY = 80_801;

const nf = new Intl.NumberFormat("es-VE", { maximumFractionDigits: 2 });
const num = (v: unknown) => nf.format(Number(v));
const date = (iso: string) => iso.split("-").reverse().join("/");
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// ------------------------------------------------------------------ Detección

async function detect(): Promise<Candidate[]> {
  const [stock, lots, qc, po, pro, so] = await Promise.all([
    query<{ warehouse_id: string; warehouse_name: string; product_id: string; product_code: string; product_name: string; unit_code: string; quantity: string; min_qty: string; max_qty: string | null; kind: string }>(
      `SELECT warehouse_id, warehouse_name, product_id, product_code, product_name, unit_code, quantity, min_qty, max_qty, kind FROM v_stock_alerts`
    ),
    query<{ lot_id: string; lot_code: string; expires_on: string; days_left: number; kind: string; product_code: string; product_name: string; unit_code: string; quantity: string; quality_status: string }>(
      `SELECT lot_id, lot_code, to_char(expires_on, 'YYYY-MM-DD') AS expires_on, days_left, kind, product_code, product_name, unit_code, quantity, quality_status
         FROM v_lots_expiring WHERE quality_status <> 'rejected'`
    ),
    query<{ id: string; lot_code: string; product_code: string; product_name: string; since: string; days: number; origin: string }>(
      `SELECT l.id, l.lot_code, p.code AS product_code, p.name AS product_name,
              to_char(COALESCE(l.received_on, l.manufactured_on, l.created_at::date), 'YYYY-MM-DD') AS since,
              (CURRENT_DATE - COALESCE(l.received_on, l.manufactured_on, l.created_at::date))::int AS days,
              CASE WHEN l.production_order_id IS NOT NULL THEN 'producción' ELSE 'compra' END AS origin
         FROM lots l JOIN products p ON p.id = l.product_id
        WHERE l.quality_status = 'quarantine'
          AND EXISTS (SELECT 1 FROM stock_balances b WHERE b.lot_id = l.id AND b.quantity > 0)
          AND CURRENT_DATE - COALESCE(l.received_on, l.manufactured_on, l.created_at::date)
              > COALESCE((fn_parameter('DASHBOARD', 'qc_pending_alert_days'))::text::int, 7)`
    ),
    query<{ id: string; number: string; supplier: string; due: string; days: number; pending_lines: number }>(
      `SELECT po.id, po.number, COALESCE(s.trade_name, s.legal_name) AS supplier, to_char(x.due, 'YYYY-MM-DD') AS due,
              (CURRENT_DATE - x.due)::int AS days, x.pending_lines
         FROM purchase_orders po
         JOIN suppliers s ON s.id = po.supplier_id
         CROSS JOIN LATERAL (
              SELECT COALESCE(MIN(d.expected_date), po.expected_date) AS due, COUNT(*)::int AS pending_lines
                FROM purchase_orders_details d
               WHERE d.purchase_order_id = po.id AND d.quantity_received < d.quantity) x
        WHERE po.status IN ('approved', 'partially_received') AND x.pending_lines > 0 AND x.due < CURRENT_DATE`
    ),
    query<{ id: string; number: string; status: string; product_code: string; product_name: string; due: string; days: number; planned: string; produced: string }>(
      `SELECT o.id, o.number, o.status, p.code AS product_code, p.name AS product_name,
              to_char(COALESCE(o.planned_end, o.planned_start), 'YYYY-MM-DD') AS due,
              (CURRENT_DATE - COALESCE(o.planned_end, o.planned_start))::int AS days,
              o.quantity_planned AS planned, o.quantity_produced AS produced
         FROM production_orders o JOIN products p ON p.id = o.product_id
        WHERE o.status IN ('created', 'released', 'in_process') AND COALESCE(o.planned_end, o.planned_start) < CURRENT_DATE`
    ),
    query<{ id: string; number: string; customer: string; due: string; days: number; created_by: string | null; status: string }>(
      `SELECT so.id, so.number, COALESCE(c.trade_name, c.legal_name) AS customer, to_char(so.requested_date, 'YYYY-MM-DD') AS due,
              (CURRENT_DATE - so.requested_date)::int AS days, so.created_by, so.status
         FROM sales_orders so JOIN customers c ON c.id = so.customer_id
        WHERE so.status IN ('confirmed', 'partially_delivered') AND so.requested_date < CURRENT_DATE`
    )
  ]);

  const out: Candidate[] = [];
  const base = { source_id: null, warehouse_id: null, owner_id: null } as const;

  for (const r of stock) {
    const below = r.kind === "below_min";
    out.push({
      ...base,
      key: `${below ? "STOCK_MIN" : "STOCK_MAX"}:${r.warehouse_id}:${r.product_id}`,
      kind: below ? "STOCK_MIN" : "STOCK_MAX",
      severity: below ? (Number(r.quantity) <= 0 ? "critical" : "warning") : "info",
      module: "INV_STOCK",
      title: `${below ? "Stock bajo el mínimo" : "Stock sobre el máximo"}: ${r.product_code}`,
      message: below
        ? `${r.product_name} en el almacén ${r.warehouse_name}: ${num(r.quantity)} ${r.unit_code} (mínimo ${num(r.min_qty)}).`
        : `${r.product_name} en el almacén ${r.warehouse_name}: ${num(r.quantity)} ${r.unit_code} (máximo ${num(r.max_qty)}).`,
      link: "/inventory/stock",
      source_id: r.product_id,
      warehouse_id: r.warehouse_id,
      data: { quantity: Number(r.quantity), minQty: Number(r.min_qty), maxQty: r.max_qty === null ? null : Number(r.max_qty), unit: r.unit_code }
    });
  }

  for (const r of lots) {
    const expired = r.kind === "expired";
    out.push({
      ...base,
      key: `${expired ? "LOT_EXPIRED" : "LOT_EXPIRING"}:${r.lot_id}`,
      kind: expired ? "LOT_EXPIRED" : "LOT_EXPIRING",
      severity: expired ? "critical" : r.days_left <= 30 ? "warning" : "info",
      module: "INV_LOTS",
      title: `${expired ? "Lote vencido" : "Lote por vencer"}: ${r.lot_code}`,
      message: expired
        ? `${r.product_name}: venció el ${date(r.expires_on)} y quedan ${num(r.quantity)} ${r.unit_code}.`
        : `${r.product_name}: vence el ${date(r.expires_on)} (${plural(r.days_left, "día", "días")}); quedan ${num(r.quantity)} ${r.unit_code}.`,
      link: "/inventory/lots",
      source_id: r.lot_id,
      data: { expiresOn: r.expires_on, daysLeft: r.days_left, quantity: Number(r.quantity), unit: r.unit_code, qualityStatus: r.quality_status }
    });
  }

  for (const r of qc) {
    out.push({
      ...base,
      key: `QC_PENDING:${r.id}`,
      kind: "QC_PENDING",
      severity: "warning",
      module: "QC_LOTS",
      title: `Lote en cuarentena hace ${plural(r.days, "día", "días")}: ${r.lot_code}`,
      message: `${r.product_name} (${r.origin}) espera la decisión de Calidad desde el ${date(r.since)}.`,
      link: "/quality/lots",
      source_id: r.id,
      data: { since: r.since, days: r.days }
    });
  }

  for (const r of po) {
    out.push({
      ...base,
      key: `PO_OVERDUE:${r.id}`,
      kind: "PO_OVERDUE",
      severity: r.days > 15 ? "critical" : "warning",
      module: "PUR_ORDERS",
      title: `OC atrasada: ${r.number}`,
      message: `${r.supplier} debía entregar el ${date(r.due)} (${plural(r.days, "día", "días")} de atraso); ${plural(r.pending_lines, "línea pendiente", "líneas pendientes")}.`,
      link: "/purchases/orders",
      source_id: r.id,
      data: { due: r.due, daysLate: r.days, pendingLines: r.pending_lines }
    });
  }

  for (const r of pro) {
    out.push({
      ...base,
      key: `PRO_LATE:${r.id}`,
      kind: "PRO_LATE",
      severity: r.days > 7 ? "critical" : "warning",
      module: "PRD_ORDERS",
      title: `OP atrasada: ${r.number}`,
      message: `${r.product_name}: debía terminar el ${date(r.due)} (${plural(r.days, "día", "días")} de atraso); producido ${num(r.produced)} de ${num(r.planned)}.`,
      link: "/production/orders",
      source_id: r.id,
      data: { due: r.due, daysLate: r.days, status: r.status, planned: Number(r.planned), produced: Number(r.produced) }
    });
  }

  for (const r of so) {
    out.push({
      ...base,
      key: `SO_LATE:${r.id}`,
      kind: "SO_LATE",
      severity: r.days > 7 ? "critical" : "warning",
      module: "SAL_ORDERS",
      title: `OV atrasada: ${r.number}`,
      message: `${r.customer} pidió la entrega para el ${date(r.due)} (${plural(r.days, "día", "días")} de atraso)${r.status === "partially_delivered" ? "; despachada en parte" : ""}.`,
      link: "/sales/orders",
      source_id: r.id,
      owner_id: r.created_by,
      data: { due: r.due, daysLate: r.days, status: r.status }
    });
  }
  return out;
}

// ------------------------------------------------------------------ Corrida

export interface RunSummary {
  id: string;
  openAlerts: number;
  newAlerts: number;
  resolvedAlerts: number;
  notifications: number;
  emails: number;
}

async function param<T>(key: string, fallback: T): Promise<T> {
  const row = await one<{ value: T }>(`SELECT fn_parameter('DASHBOARD', $1) AS value`, [key]);
  return row?.value ?? fallback;
}

/**
 * @function runAlerts
 * @description Una corrida completa del detector. Lanza ALERTS_RUNNING si otra está en curso.
 */
export async function runAlerts(trigger: "schedule" | "manual", runBy: string | null = null): Promise<RunSummary> {
  const run = (await one<{ id: string }>(`INSERT INTO alerts_runs (trigger, run_by) VALUES ($1, $2) RETURNING id`, [trigger, runBy]))!;
  try {
    const candidates = await detect();
    const result = await withTx({ userId: runBy, traceId: null }, async (client) => {
      const lock = await client.query<{ ok: boolean }>(`SELECT pg_try_advisory_xact_lock($1) AS ok`, [LOCK_KEY]);
      if (!lock.rows[0].ok) return null;

      const sync = await client.query<{ new_ids: string[] | null; resolved: number; open: number }>(
        `WITH c AS (
           SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(key text, kind text, severity text, module text, title text, message text,
                                                            link text, source_id uuid, warehouse_id uuid, owner_id uuid, data jsonb)),
         upd AS (
           UPDATE alerts a SET severity = c.severity, title = c.title, message = c.message, link = c.link, data = c.data,
                               owner_id = c.owner_id, last_seen_at = NOW()
             FROM c WHERE a.alert_key = c.key AND a.resolved_at IS NULL
           RETURNING a.id),
         ins AS (
           INSERT INTO alerts (alert_key, kind, severity, module_code, title, message, link, source_id, warehouse_id, owner_id, data)
           SELECT c.key, c.kind, c.severity, c.module, c.title, c.message, c.link, c.source_id, c.warehouse_id, c.owner_id, c.data
             FROM c WHERE NOT EXISTS (SELECT 1 FROM alerts a WHERE a.alert_key = c.key AND a.resolved_at IS NULL)
           RETURNING id),
         res AS (
           UPDATE alerts a SET resolved_at = NOW()
            WHERE a.resolved_at IS NULL AND NOT EXISTS (SELECT 1 FROM c WHERE c.key = a.alert_key)
           RETURNING a.id)
         SELECT (SELECT array_agg(id) FROM ins) AS new_ids, (SELECT COUNT(*) FROM res)::int AS resolved,
                ((SELECT COUNT(*) FROM upd) + (SELECT COUNT(*) FROM ins))::int AS open`,
        [JSON.stringify(candidates)]
      );
      const { new_ids, resolved, open } = sync.rows[0];
      const newIds = new_ids ?? [];

      const notified = newIds.length
        ? await client.query<{ id: string }>(
            `INSERT INTO notifications (user_id, alert_id, kind, severity, title, message, link)
             SELECT u.id, a.id, a.kind, a.severity, a.title, a.message, a.link
               FROM alerts a CROSS JOIN users u
              WHERE a.id = ANY($1) AND u.is_active AND ${alertVisibleTo("u.id")}
             ON CONFLICT (user_id, alert_id) DO NOTHING
             RETURNING id`,
            [newIds]
          )
        : { rows: [] };

      await client.query(
        `DELETE FROM notifications WHERE is_read
            AND read_at < NOW() - make_interval(days => COALESCE((fn_parameter('DASHBOARD', 'notifications_retention_days'))::text::int, 90))`
      );
      return { newAlerts: newIds.length, resolvedAlerts: resolved, openAlerts: open, notificationIds: notified.rows.map((r) => r.id) };
    });

    if (!result) {
      await pool.query(`UPDATE alerts_runs SET finished_at = NOW(), error = 'Otra corrida estaba en curso' WHERE id = $1`, [run.id]);
      throw conflict("ALERTS_RUNNING", "Ya hay una revisión de alertas en curso; intente en unos segundos");
    }

    const emails = (await param("alerts_email", true)) ? await emailDigests(result.notificationIds) : 0;
    const summary: RunSummary = {
      id: run.id,
      openAlerts: result.openAlerts,
      newAlerts: result.newAlerts,
      resolvedAlerts: result.resolvedAlerts,
      notifications: result.notificationIds.length,
      emails
    };
    await pool.query(
      `UPDATE alerts_runs SET finished_at = NOW(), open_alerts = $2, new_alerts = $3, resolved_alerts = $4, notifications = $5, emails = $6 WHERE id = $1`,
      [run.id, summary.openAlerts, summary.newAlerts, summary.resolvedAlerts, summary.notifications, summary.emails]
    );
    return summary;
  } catch (err) {
    await pool
      .query(`UPDATE alerts_runs SET finished_at = NOW(), error = COALESCE(error, $2) WHERE id = $1`, [run.id, String((err as Error).message ?? err).slice(0, 800)])
      .catch(() => undefined);
    throw err;
  }
}

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

/** Un correo por destinatario con sus alertas nuevas; marca emailed_at en lo enviado */
async function emailDigests(notificationIds: string[]): Promise<number> {
  if (notificationIds.length === 0) return 0;
  const groups = await query<{ user_id: string; email: string; names: string; items: { id: string; severity: Severity; title: string; message: string; link: string | null }[] }>(
    `SELECT u.id AS user_id, u.email::text AS email, u.names,
            json_agg(json_build_object('id', n.id, 'severity', n.severity, 'title', n.title, 'message', n.message, 'link', n.link)) AS items
       FROM notifications n JOIN users u ON u.id = n.user_id
      WHERE n.id = ANY($1) AND u.is_active
      GROUP BY u.id, u.email, u.names`,
    [notificationIds]
  );
  let sent = 0;
  for (const g of groups) {
    const items = [...g.items].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
    if (await sendAlertDigest(g.email, g.names, items)) {
      sent++;
      await pool.query(`UPDATE notifications SET emailed_at = NOW() WHERE id = ANY($1)`, [items.map((i) => i.id)]);
    }
  }
  return sent;
}

// ------------------------------------------------------------------ Job periódico

let timer: NodeJS.Timeout | null = null;

/** Programa el detector: primera corrida al minuto del arranque, luego cada alerts_interval_minutes */
export function startAlertScheduler(firstDelayMs = 60_000): void {
  const tick = async () => {
    let minutes = 60;
    try {
      minutes = Number(await param("alerts_interval_minutes", 60)) || 60;
      if (await param("alerts_enabled", true)) {
        const s = await runAlerts("schedule");
        logger.info(s, "[alerts] corrida programada");
      }
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "ALERTS_RUNNING") logger.info("[alerts] corrida programada omitida: otra en curso");
      else logger.error({ err }, "[alerts] la corrida programada falló");
    } finally {
      timer = setTimeout(tick, Math.max(5, minutes) * 60_000);
      timer.unref();
    }
  };
  timer = setTimeout(tick, firstDelayMs);
  timer.unref();
}

// ------------------------------------------------------------------ Pantalla de Alertas

const SELECT_ALERT = `SELECT a.id, a.kind, a.severity, a.module_code AS "moduleCode", m.name AS "moduleName", a.title, a.message, a.link,
  a.data, w.code AS "warehouseCode", a.first_seen_at AS "firstSeenAt", a.last_seen_at AS "lastSeenAt", a.resolved_at AS "resolvedAt"
  FROM alerts a JOIN catalogs_modules m ON m.code = a.module_code LEFT JOIN warehouses w ON w.id = a.warehouse_id`;

const listQuery = pageQuery.extend({
  status: z.enum(["open", "resolved"]).default("open"),
  kind: z.enum(ALERT_KINDS).optional(),
  severity: z.enum(["info", "warning", "critical"]).optional(),
  search: z.string().trim().max(80).optional()
});

export const listAlerts = handler({ query: listQuery }, async ({ query: q, req }) => {
  const rows = await query(
    `SELECT COUNT(*) OVER()::int AS total, x.* FROM (${SELECT_ALERT}
      WHERE ${alertVisibleTo("$1")}
        AND (CASE WHEN $2::text = 'open' THEN a.resolved_at IS NULL ELSE a.resolved_at IS NOT NULL END)
        AND ($3::text IS NULL OR a.kind = $3)
        AND ($4::text IS NULL OR a.severity = $4)
        AND ($5::text IS NULL OR a.title ILIKE '%' || $5 || '%' OR a.message ILIKE '%' || $5 || '%')) x
      ORDER BY CASE x.severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
               CASE WHEN $2::text = 'open' THEN x."firstSeenAt" END DESC, x."resolvedAt" DESC
      LIMIT $6 OFFSET $7`,
    [authOf(req).userId, q.status, q.kind ?? null, q.severity ?? null, q.search || null, q.pageSize, (q.page - 1) * q.pageSize]
  );
  const total = (rows[0]?.total as number | undefined) ?? 0;
  return { items: rows.map(({ total: _t, ...r }) => r), total, page: q.page, pageSize: q.pageSize };
});

/** Alertas abiertas visibles por tipo y severidad (tarjetas de Alertas y del Tablero) */
export async function alertsSummaryFor(userId: string) {
  const rows = await query<{ kind: string; severity: Severity; count: number }>(
    `SELECT a.kind, a.severity, COUNT(*)::int AS count FROM alerts a
      WHERE a.resolved_at IS NULL AND ${alertVisibleTo("$1")} GROUP BY a.kind, a.severity`,
    [userId]
  );
  const bySeverity = { critical: 0, warning: 0, info: 0 };
  const byKind: Record<string, number> = {};
  for (const r of rows) {
    bySeverity[r.severity] += r.count;
    byKind[r.kind] = (byKind[r.kind] ?? 0) + r.count;
  }
  const lastRun = await one(
    `SELECT started_at AS "startedAt", finished_at AS "finishedAt", trigger, error FROM alerts_runs WHERE finished_at IS NOT NULL ORDER BY started_at DESC LIMIT 1`
  );
  return { total: bySeverity.critical + bySeverity.warning + bySeverity.info, bySeverity, byKind, lastRun };
}

export const alertsSummary = handler({}, ({ req }) => alertsSummaryFor(authOf(req).userId));

export const listRuns = handler({}, () =>
  query(
    `SELECT r.id, r.trigger, u.names AS "runBy", r.started_at AS "startedAt", r.finished_at AS "finishedAt",
            r.open_alerts AS "openAlerts", r.new_alerts AS "newAlerts", r.resolved_alerts AS "resolvedAlerts",
            r.notifications, r.emails, r.error
       FROM alerts_runs r LEFT JOIN users u ON u.id = r.run_by
      ORDER BY r.started_at DESC LIMIT 30`
  )
);

export const runNow = handler({}, ({ req }) => runAlerts("manual", authOf(req).userId));
