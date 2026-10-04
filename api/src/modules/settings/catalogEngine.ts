/**
 * @project FabriHub - API
 * @file src/modules/settings/catalogEngine.ts
 * @description Motor genérico de catálogos simples (código + nombre + campos propios)
 *
 * @overview
 * Los catálogos comerciales de la tesis (condición de pago, condición de entrega, método de
 * entrega, tipo de negocio, zona, moneda) tienen la misma forma. En vez de seis CRUD
 * copiados, cada catálogo se DECLARA aquí y el motor genera listar/crear/editar/eliminar.
 *
 * Seguridad: los nombres de tabla y columna salen SOLO de este registro (nunca del request),
 * así que interpolarlos en el SQL es seguro. Los valores siempre van parametrizados.
 */

import { z, type ZodType } from "zod";

export const appliesTo = z.enum(["purchases", "sales", "both"]);

export interface ExtraField {
  /** Nombre en la API (camelCase) */
  key: string;
  /** Columna en la BD */
  column: string;
  schema: ZodType;
}

export interface CatalogDef {
  key: string;
  table: string;
  label: string;
  module: string;
  codeSchema?: ZodType<string>;
  extra: ExtraField[];
  /**
   * Si se define, la tabla tiene `is_system`: los registros de sistema no se eliminan y estos
   * campos no se pueden cambiar (los usa el código de otros módulos).
   */
  systemLocked?: string[];
}

const defaultCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9_-]{1,20}$/, "Solo mayúsculas, números, - y _ (máx. 20)");

const SET_COMMERCIAL = "SET_COMMERCIAL";
const INV_CATALOGS = "INV_CATALOGS";
const PUR_BUYERS = "PUR_BUYERS";
const PRD_STAGES = "PRD_STAGES";
const PRD_CENTERS = "PRD_CENTERS";
const SAL_SELLERS = "SAL_SELLERS";

export const CATALOGS: Record<string, CatalogDef> = {
  "payment-terms": {
    key: "payment-terms",
    table: "catalogs_payment_terms",
    label: "Condiciones de pago",
    module: SET_COMMERCIAL,
    extra: [
      { key: "days", column: "days", schema: z.number().int().min(0).max(365) },
      { key: "appliesTo", column: "applies_to", schema: appliesTo }
    ]
  },
  "delivery-terms": {
    key: "delivery-terms",
    table: "catalogs_delivery_terms",
    label: "Condiciones de entrega",
    module: SET_COMMERCIAL,
    extra: [{ key: "appliesTo", column: "applies_to", schema: appliesTo }]
  },
  "delivery-methods": {
    key: "delivery-methods",
    table: "catalogs_delivery_methods",
    label: "Métodos de entrega",
    module: SET_COMMERCIAL,
    extra: [{ key: "appliesTo", column: "applies_to", schema: appliesTo }]
  },
  "business-types": {
    key: "business-types",
    table: "catalogs_business_types",
    label: "Tipos de negocio",
    module: SET_COMMERCIAL,
    extra: [{ key: "appliesTo", column: "applies_to", schema: appliesTo }]
  },
  zones: {
    key: "zones",
    table: "catalogs_zones",
    label: "Zonas",
    module: SET_COMMERCIAL,
    extra: []
  },
  currencies: {
    key: "currencies",
    table: "catalogs_currencies",
    label: "Monedas",
    module: SET_COMMERCIAL,
    codeSchema: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Código ISO 4217 de 3 letras"),
    extra: [
      { key: "symbol", column: "symbol", schema: z.string().trim().min(1).max(8) },
      { key: "decimals", column: "decimals", schema: z.number().int().min(0).max(6) }
    ]
  },

  // ---------------------------------------------------------------- Inventario (fase 3)
  units: {
    key: "units",
    table: "catalogs_units",
    label: "Unidades",
    module: INV_CATALOGS,
    extra: [{ key: "decimals", column: "decimals", schema: z.number().int().min(0).max(6) }]
  },
  "product-types": {
    key: "product-types",
    table: "catalogs_product_types",
    label: "Tipos de producto",
    module: INV_CATALOGS,
    extra: [
      {
        key: "nature",
        column: "nature",
        schema: z.enum(["raw_material", "packaging", "semi_finished", "finished", "spare_part", "service"])
      }
    ]
  },
  "product-families": {
    key: "product-families",
    table: "catalogs_product_families",
    label: "Familias",
    module: INV_CATALOGS,
    extra: []
  },
  "product-categories": {
    key: "product-categories",
    table: "catalogs_product_categories",
    label: "Categorías",
    module: INV_CATALOGS,
    extra: []
  },
  "movement-concepts": {
    key: "movement-concepts",
    table: "catalogs_movement_concepts",
    label: "Conceptos de movimiento",
    module: INV_CATALOGS,
    extra: [
      { key: "movementTypeId", column: "movement_type_id", schema: z.uuid() },
      { key: "moduleCode", column: "module_code", schema: z.enum(["INVENTORY", "PURCHASES", "SALES", "PRODUCTION"]) },
      { key: "lotStatusOnEntry", column: "lot_status_on_entry", schema: z.enum(["approved", "quarantine"]) },
      { key: "allowsUnapprovedLots", column: "allows_unapproved_lots", schema: z.boolean() }
    ],
    systemLocked: ["movementTypeId", "moduleCode", "lotStatusOnEntry"]
  },

  // ---------------------------------------------------------------- Compras (fase 4)
  buyers: {
    key: "buyers",
    table: "buyers",
    label: "Compradores",
    module: PUR_BUYERS,
    extra: [
      { key: "phone", column: "phone", schema: z.string().trim().max(30).nullable() },
      { key: "email", column: "email", schema: z.email().max(200).nullable().or(z.literal("").transform(() => null)) }
    ]
  },
  // Producción (fase 5)
  stages: {
    key: "stages",
    table: "stages",
    label: "Etapas",
    module: PRD_STAGES,
    extra: []
  },
  "work-center-types": {
    key: "work-center-types",
    table: "catalogs_work_center_types",
    label: "Tipos de centro de trabajo",
    module: PRD_CENTERS,
    extra: []
  },
  // Ventas (fase 6)
  sellers: {
    key: "sellers",
    table: "sellers",
    label: "Vendedores",
    module: SAL_SELLERS,
    extra: [
      { key: "phone", column: "phone", schema: z.string().trim().max(30).nullable() },
      { key: "email", column: "email", schema: z.email().max(200).nullable().or(z.literal("").transform(() => null)) },
      { key: "commissionPct", column: "commission_pct", schema: z.number().min(0).max(100) }
    ]
  }
};

/** Esquema de alta: comunes + extras del catálogo (todos obligatorios salvo los opcionales) */
export function createSchema(def: CatalogDef) {
  const shape: Record<string, ZodType> = {
    code: def.codeSchema ?? defaultCode,
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().max(400).nullish(),
    orderList: z.number().int().min(0).max(9999).optional()
  };
  for (const f of def.extra) shape[f.key] = f.schema;
  return z.object(shape).strict();
}

/** Esquema de edición: todo opcional, el código no cambia (lo referencian documentos) */
export function updateSchema(def: CatalogDef) {
  const shape: Record<string, ZodType> = {
    name: z.string().trim().min(2).max(120).optional(),
    description: z.string().trim().max(400).nullish(),
    orderList: z.number().int().min(0).max(9999).optional(),
    isActive: z.boolean().optional()
  };
  for (const f of def.extra) shape[f.key] = f.schema.optional();
  return z
    .object(shape)
    .strict()
    .refine((b) => Object.keys(b).length > 0, "Nada que actualizar");
}

/** Columnas SELECT con alias camelCase */
export function selectColumns(def: CatalogDef): string {
  const extra = def.extra.map((f) => `${f.column} AS "${f.key}"`).join(", ");
  return [
    "id",
    "code",
    "name",
    "description",
    `is_active AS "isActive"`,
    `order_list AS "orderList"`,
    `updated_at AS "updatedAt"`,
    def.systemLocked ? `is_system AS "isSystem"` : "",
    extra
  ]
    .filter(Boolean)
    .join(", ");
}

/** Mapa API → columna para los campos editables */
export function columnMap(def: CatalogDef): Record<string, string> {
  const map: Record<string, string> = {
    code: "code",
    name: "name",
    description: "description",
    orderList: "order_list",
    isActive: "is_active"
  };
  for (const f of def.extra) map[f.key] = f.column;
  return map;
}
