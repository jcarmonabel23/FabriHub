/**
 * @project FabriHub - API
 * @file src/lib/http.ts
 * @description Errores HTTP de negocio y envoltorio de handlers con validación zod
 *
 * @overview
 * Cada endpoint es un handler aislado (equivalente a una lambda de DaviHub). `handler()`
 * valida body/query/params con zod ANTES de ejecutar la lógica, y convierte errores en
 * respuestas uniformes `{ error: { code, message } }`. Nunca se envía el stack al cliente.
 */

import type { Request, Response, NextFunction, RequestHandler } from "express";
import { z, type ZodType } from "zod";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
  }
}

export const badRequest = (code: string, message: string, details?: unknown) =>
  new HttpError(400, code, message, details);
export const unauthorized = (code = "UNAUTHORIZED", message = "Sesión no válida") => new HttpError(401, code, message);
export const forbidden = (code = "FORBIDDEN", message = "No tiene permiso para esta acción") =>
  new HttpError(403, code, message);
export const notFound = (message = "Registro no encontrado") => new HttpError(404, "NOT_FOUND", message);
export const conflict = (code: string, message: string) => new HttpError(409, code, message);

interface Schemas<B extends ZodType, Q extends ZodType, P extends ZodType> {
  body?: B;
  query?: Q;
  params?: P;
}

export interface Input<B, Q, P> {
  body: B;
  query: Q;
  params: P;
  req: Request;
  res: Response;
}

/**
 * @function handler
 * @description Crea un RequestHandler que valida entrada y responde JSON con lo que devuelva `fn`
 */
export function handler<B extends ZodType = ZodType<unknown>, Q extends ZodType = ZodType<unknown>, P extends ZodType = ZodType<unknown>>(
  schemas: Schemas<B, Q, P>,
  fn: (input: Input<z.infer<B>, z.infer<Q>, z.infer<P>>) => Promise<unknown>
): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = schemas.body ? schemas.body.parse(req.body ?? {}) : req.body;
      const query = schemas.query ? schemas.query.parse(req.query) : req.query;
      const params = schemas.params ? schemas.params.parse(req.params) : req.params;
      const result = await fn({ body, query, params, req, res } as Input<z.infer<B>, z.infer<Q>, z.infer<P>>);
      if (!res.headersSent) {
        if (result === undefined) res.status(204).end();
        else res.json(result);
      }
    } catch (err) {
      next(err);
    }
  };
}

/** Esquema reutilizable para `:id` UUID */
export const idParams = z.object({ id: z.uuid() });

/** Paginación estándar */
export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25)
});
