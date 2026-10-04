/**
 * @project FabriHub - API
 * @file src/modules/auth/me.ts
 * @description GET /auth/me — perfil y módulos/permisos efectivos de la sesión actual
 */

import { handler } from "../../lib/http.js";
import { authOf } from "../../security/context.js";
import { sessionPayload } from "./service.js";

export const me = handler({}, async ({ req }) => {
  const auth = authOf(req);
  return sessionPayload({
    id: auth.userId,
    email: auth.email,
    names: auth.names,
    mustChangePassword: auth.mustChangePassword
  });
});
