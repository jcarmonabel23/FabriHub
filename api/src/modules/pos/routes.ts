/**
 * @project FabriHub - API
 * @file src/modules/pos/routes.ts
 * @description Rutas del punto de venta (/api/v1/pos)
 *
 * Permisos:
 *  - POS_TERMINALS: configurar cajas (view / add_new / edit / delete).
 *  - POS_SESSIONS:  add_new = abrir turno, close = cerrar, view_all = ver y cerrar los de otros.
 *  - POS_SALES:     add_new = vender (catálogo, clientes, cotizar), view / view_all = comprobantes,
 *                   approve = supervisor (descuentos sobre el límite y anulaciones).
 */

import { Router } from "express";
import { requirePermission as can } from "../../security/authorize.js";
import { posTicketPdf } from "../documents/pdfs.js";
import { createSale, getSale, listSales, posCatalog, quickCreateCustomer, quoteSale, searchCustomers, voidSale } from "./sales.js";
import { closeSession, getSession, listSessions, mySession, openSession } from "./sessions.js";
import { listSupervisors, setMyPin } from "./supervisor.js";
import { createTerminal, deleteTerminal, getTerminal, listTerminals, updateTerminal } from "./terminals.js";

export const posRoutes = Router();

// Cajas
posRoutes.get("/terminals", can("POS_TERMINALS", "view"), listTerminals);
posRoutes.get("/terminals/:id", can("POS_TERMINALS", "view"), getTerminal);
posRoutes.post("/terminals", can("POS_TERMINALS", "add_new"), createTerminal);
posRoutes.put("/terminals/:id", can("POS_TERMINALS", "edit"), updateTerminal);
posRoutes.delete("/terminals/:id", can("POS_TERMINALS", "delete"), deleteTerminal);

// Turnos
posRoutes.get("/me", can("POS_SALES", "add_new"), mySession);
posRoutes.get("/sessions", can("POS_SESSIONS", "view"), listSessions);
posRoutes.get("/sessions/:id", can("POS_SESSIONS", "view"), getSession);
posRoutes.post("/sessions", can("POS_SESSIONS", "add_new"), openSession);
posRoutes.post("/sessions/:id/close", can("POS_SESSIONS", "close"), closeSession);

// Venta
posRoutes.get("/catalog", can("POS_SALES", "add_new"), posCatalog);
posRoutes.get("/customers", can("POS_SALES", "add_new"), searchCustomers);
posRoutes.post("/customers", can("POS_SALES", "add_new"), quickCreateCustomer);
posRoutes.get("/supervisors", can("POS_SALES", "add_new"), listSupervisors);
posRoutes.put("/supervisor-pin", can("POS_SALES", "approve"), setMyPin);
posRoutes.post("/sales/quote", can("POS_SALES", "add_new"), quoteSale);
posRoutes.post("/sales", can("POS_SALES", "add_new"), createSale);
posRoutes.get("/sales", can("POS_SALES", "view"), listSales);
posRoutes.get("/sales/:id", can("POS_SALES", "view"), getSale);
posRoutes.get("/sales/:id/pdf", can("POS_SALES", "view"), posTicketPdf);
posRoutes.post("/sales/:id/void", can("POS_SALES", "add_new"), voidSale);
