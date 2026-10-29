/**
 * @project FabriHub - API
 * @file src/modules/auth/companies.ts
 * @description GET /auth/companies (empresas del usuario) y POST /auth/switch-company (cambiar la activa)
 *
 * @overview
 * La empresa activa vive en la sesión (users_sessions.company_id), no en el token: cambiarla
 * surte efecto en la siguiente petición. Las demás pestañas de la misma sesión lo notan por
 * 409 COMPANY_CHANGED (ver authenticate) y recargan.
 */

import { z } from "zod";
import { one, query } from "../../db.js";
import { forbidden, handler } from "../../lib/http.js";
import { logAuth } from "../../lib/authLog.js";
import { authOf } from "../../security/context.js";
import { sessionPayload } from "./service.js";

export const myCompanies = handler({}, ({ req }) =>
  query(
    `SELECT c.id, c.code, COALESCE(c.trade_name, c.legal_name) AS name, c.rif,
            uc.is_default AS "isDefault", c.id = $2 AS "isCurrent"
       FROM users_companies uc JOIN companies c ON c.id = uc.company_id
      WHERE uc.user_id = $1 AND uc.is_active AND c.is_active
      ORDER BY name`,
    [authOf(req).userId, authOf(req).companyId]
  )
);

const switchBody = z.object({ companyId: z.uuid(), makeDefault: z.boolean().default(false) });

export const switchCompany = handler({ body: switchBody }, async ({ body, req }) => {
  const auth = authOf(req);
  const member = await one(
    `SELECT 1 FROM users_companies uc JOIN companies c ON c.id = uc.company_id AND c.is_active
      WHERE uc.user_id = $1 AND uc.company_id = $2 AND uc.is_active`,
    [auth.userId, body.companyId]
  );
  if (!member) throw forbidden("COMPANY_FORBIDDEN", "No tiene acceso a esa empresa");

  await query(`UPDATE users_sessions SET company_id = $2 WHERE id = $1`, [auth.sessionId, body.companyId]);
  if (body.makeDefault) {
    await query(
      `UPDATE users_companies SET is_default = (company_id = $2)
        WHERE user_id = $1 AND is_default <> (company_id = $2)`,
      [auth.userId, body.companyId]
    );
  }
  await logAuth(req, "switch_company", true, {
    userId: auth.userId,
    email: auth.email,
    detail: { from: auth.companyId, to: body.companyId }
  });

  return sessionPayload(
    { id: auth.userId, email: auth.email, names: auth.names, mustChangePassword: auth.mustChangePassword },
    body.companyId
  );
});
