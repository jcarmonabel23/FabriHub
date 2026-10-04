/**
 * @project FabriHub - Front
 * @file src/app/settings/commercial/catalogsUi.ts
 * @description Declaración de la UI de cada catálogo comercial (espejo de api/.../catalogEngine.ts)
 *
 * Agregar un catálogo nuevo = una entrada aquí y otra en el motor de la API. No hay pantallas
 * nuevas que escribir.
 */

import { APPLIES_TO_LABEL, APPLIES_TO_OPTIONS } from "../settingsActions";

export interface FieldUi {
  key: string;
  label: string;
  type: "text" | "number" | "select" | "switch" | "ref";
  /** Para type "ref": catálogo de /lookups que da las opciones (se muestra código · nombre) */
  lookup?: string;
  /** Bloqueado en registros del sistema (espejo de systemLocked de la API) */
  systemLocked?: boolean;
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  default: unknown;
  /** Cómo mostrar el valor en la tabla */
  render?: (v: unknown) => string;
}

export interface CatalogUi {
  key: string;
  /** Módulo cuyos permisos gobiernan el catálogo (useCan) */
  module: string;
  label: string;
  singular: string;
  /** Para "Nuevo" / "Nueva" en el título del formulario */
  feminine: boolean;
  codeHint: string;
  codeMaxLength: number;
  fields: FieldUi[];
}

const appliesTo: FieldUi = {
  key: "appliesTo",
  label: "Se usa en",
  type: "select",
  options: APPLIES_TO_OPTIONS,
  default: "both",
  render: (v) => APPLIES_TO_LABEL[String(v)] ?? String(v)
};

export const COMMERCIAL_CATALOGS: CatalogUi[] = [
  {
    key: "payment-terms",
    module: "SET_COMMERCIAL",
    label: "Condiciones de pago",
    singular: "condición de pago",
    feminine: true,
    codeHint: "p. ej. CR30",
    codeMaxLength: 20,
    fields: [
      { key: "days", label: "Días de crédito", type: "number", min: 0, max: 365, default: 0, render: (v) => `${v} días` },
      appliesTo
    ]
  },
  {
    key: "delivery-terms",
    module: "SET_COMMERCIAL",
    label: "Condiciones de entrega",
    singular: "condición de entrega",
    feminine: true,
    codeHint: "p. ej. EXW",
    codeMaxLength: 20,
    fields: [appliesTo]
  },
  {
    key: "delivery-methods",
    module: "SET_COMMERCIAL",
    label: "Métodos de entrega",
    singular: "método de entrega",
    feminine: false,
    codeHint: "p. ej. PROPIO",
    codeMaxLength: 20,
    fields: [appliesTo]
  },
  {
    key: "business-types",
    module: "SET_COMMERCIAL",
    label: "Tipos de negocio",
    singular: "tipo de negocio",
    feminine: false,
    codeHint: "p. ej. FARMACIA",
    codeMaxLength: 20,
    fields: [appliesTo]
  },
  { key: "zones", module: "SET_COMMERCIAL", label: "Zonas", singular: "zona", feminine: true, codeHint: "p. ej. CENTRAL", codeMaxLength: 20, fields: [] },
  {
    key: "currencies",
    module: "SET_COMMERCIAL",
    label: "Monedas",
    singular: "moneda",
    feminine: true,
    codeHint: "ISO 4217: USD",
    codeMaxLength: 3,
    fields: [
      { key: "symbol", label: "Símbolo", type: "text", default: "" },
      { key: "decimals", label: "Decimales", type: "number", min: 0, max: 6, default: 2 }
    ]
  }
];

const NATURE_OPTIONS = [
  { value: "raw_material", label: "Materia prima" },
  { value: "packaging", label: "Material de empaque" },
  { value: "semi_finished", label: "Semielaborado" },
  { value: "finished", label: "Producto terminado" },
  { value: "spare_part", label: "Repuesto" },
  { value: "service", label: "Servicio (no inventariable)" }
];
const MODULE_OPTIONS = [
  { value: "INVENTORY", label: "Inventario (manual)" },
  { value: "PURCHASES", label: "Compras" },
  { value: "SALES", label: "Ventas" },
  { value: "PRODUCTION", label: "Producción" }
];
const LOT_STATUS_OPTIONS = [
  { value: "approved", label: "Liberado" },
  { value: "quarantine", label: "Cuarentena" }
];
const labelOf = (opts: { value: string; label: string }[]) => (v: unknown) => opts.find((o) => o.value === v)?.label ?? String(v ?? "");

/** Catálogos de Inventario (fase 3), mismo motor */
export const INVENTORY_CATALOGS: CatalogUi[] = [
  {
    key: "units",
    module: "INV_CATALOGS",
    label: "Unidades",
    singular: "unidad",
    feminine: true,
    codeHint: "p. ej. KG",
    codeMaxLength: 20,
    fields: [{ key: "decimals", label: "Decimales", type: "number", min: 0, max: 6, default: 2 }]
  },
  {
    key: "product-types",
    module: "INV_CATALOGS",
    label: "Tipos de producto",
    singular: "tipo de producto",
    feminine: false,
    codeHint: "p. ej. MP",
    codeMaxLength: 20,
    fields: [{ key: "nature", label: "Naturaleza", type: "select", options: NATURE_OPTIONS, default: "raw_material", render: labelOf(NATURE_OPTIONS) }]
  },
  { key: "product-families", module: "INV_CATALOGS", label: "Familias", singular: "familia", feminine: true, codeHint: "p. ej. ANALG", codeMaxLength: 20, fields: [] },
  { key: "product-categories", module: "INV_CATALOGS", label: "Categorías", singular: "categoría", feminine: true, codeHint: "p. ej. SOLIDOS", codeMaxLength: 20, fields: [] },
  {
    key: "movement-concepts",
    module: "INV_CATALOGS",
    label: "Conceptos de movimiento",
    singular: "concepto",
    feminine: false,
    codeHint: "p. ej. MUESTRAS",
    codeMaxLength: 20,
    fields: [
      { key: "movementTypeId", label: "Tipo", type: "ref", lookup: "movement-types", default: null, systemLocked: true },
      { key: "moduleCode", label: "Módulo", type: "select", options: MODULE_OPTIONS, default: "INVENTORY", systemLocked: true, render: labelOf(MODULE_OPTIONS) },
      { key: "lotStatusOnEntry", label: "Lotes nuevos entran", type: "select", options: LOT_STATUS_OPTIONS, default: "approved", systemLocked: true, render: labelOf(LOT_STATUS_OPTIONS) },
      { key: "allowsUnapprovedLots", label: "Saca lotes no liberados", type: "switch", default: false, render: (v) => (v ? "Sí" : "No") }
    ]
  }
];
