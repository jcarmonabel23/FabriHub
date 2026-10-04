/**
 * @project FabriHub - Front
 * @file src/app/inventory/types.ts
 * @description Modelos del subsistema Inventario
 */

export type Direction = "in" | "out" | "transfer";
export type QualityStatus = "quarantine" | "approved" | "rejected" | "on_hold";

export interface ProductRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
  tags: string[];
  productTypeId: string;
  typeCode: string;
  typeName: string;
  nature: string;
  familyId: string | null;
  familyName: string | null;
  categoryId: string | null;
  categoryName: string | null;
  stockUnitId: string;
  stockUnitCode: string;
  unitDecimals: number;
  purchaseUnitId: string | null;
  purchaseFactor: number;
  saleUnitId: string | null;
  saleFactor: number;
  productionUnitId: string | null;
  productionFactor: number;
  isStockable: boolean;
  isLotControlled: boolean;
  isPurchased: boolean;
  isSold: boolean;
  isManufactured: boolean;
  isOnHold: boolean;
  shelfLifeDays: number | null;
  fiscalTreatmentId: string | null;
  fiscalTreatmentCode: string | null;
  salePrice: number | null;
  purchasePrice: number | null;
  standardCost: number | null;
  totalQuantity: number;
  updatedAt: string;
}

export interface ProductRelation {
  id: string;
  kind: "substitute" | "complementary" | "equivalent";
  validFrom: string | null;
  notes: string | null;
  relatedProductId: string;
  relatedCode: string;
  relatedName: string;
}

export interface ProductDetail extends ProductRow {
  relations: ProductRelation[];
  stock: { warehouseId: string; warehouseCode: string; warehouseName: string; quantity: number; avgCost: number; value: number }[];
}

export interface Warehouse {
  id: string;
  code: string;
  name: string;
  description: string | null;
  address: string | null;
  kind: "storage" | "production" | "transit";
  isActive: boolean;
  productsWithStock: number;
  stockValue: number;
  policies: number;
  users: number;
}

export interface Policy {
  productId: string;
  productCode: string;
  productName: string;
  unitCode: string;
  minQty: number;
  maxQty: number | null;
  quantity: number;
  status: "below_min" | "above_max" | "ok";
}

export interface Lot {
  id: string;
  internalNumber: number;
  lotCode: string;
  description: string | null;
  productId: string;
  productCode: string;
  productName: string;
  unitCode: string;
  manufacturedOn: string | null;
  expiresOn: string | null;
  receivedOn: string | null;
  bestBefore: string | null;
  qualityStatus: QualityStatus;
  supplierLot: string | null;
  unitCost: number | null;
  daysToExpire: number | null;
  quantity: number;
}

export interface LotDetail extends Lot {
  stock: { warehouseCode: string; warehouseName: string; quantity: number; reserved: number }[];
  history: {
    movementId: string;
    number: string;
    movementDate: string;
    direction: Direction;
    conceptName: string;
    warehouseCode: string;
    targetWarehouseCode: string | null;
    quantity: number;
    unitCost: number;
    status: string;
  }[];
}

export interface MovementLine {
  lineNo: number;
  productId: string;
  productCode: string;
  productName: string;
  unitCode: string;
  lotId: string | null;
  lotCode: string | null;
  expiresOn: string | null;
  quantity: number;
  unitCost: number;
  totalCost: number;
  avgCostAfter: number;
  balanceAfter: number;
  targetAvgCostAfter: number | null;
  targetBalanceAfter: number | null;
  notes: string | null;
}

export interface Movement {
  id: string;
  number: string;
  movementDate: string;
  direction: Direction;
  status: "posted" | "reversed";
  conceptId: string;
  conceptCode: string;
  conceptName: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  targetWarehouseId: string | null;
  targetWarehouseCode: string | null;
  targetWarehouseName: string | null;
  reference: string | null;
  notes: string | null;
  sourceModule: string;
  lines: number;
  totalCost: number;
  postedAt: string;
  createdBy: string | null;
  reversalOfId: string | null;
  reversalOfNumber: string | null;
  reversedById: string | null;
  reversedByNumber: string | null;
}

export interface MovementDetail extends Omit<Movement, "lines"> {
  lines: MovementLine[];
}

export interface Concept {
  id: string;
  code: string;
  name: string;
  description: string | null;
  direction: Direction;
  lotStatusOnEntry: "approved" | "quarantine";
  allowsUnapprovedLots: boolean;
}

export interface LotOption {
  id: string;
  lotCode: string;
  expiresOn: string | null;
  qualityStatus: QualityStatus;
  available: number;
  expired: boolean;
}

export interface ProductOption {
  id: string;
  code: string;
  name: string;
  unitCode: string;
  unitDecimals: number;
  isLotControlled: boolean;
  isStockable: boolean;
  shelfLifeDays: number | null;
  isOnHold: boolean;
  stockUnitId?: string;
  purchaseUnitId?: string | null;
  purchaseUnitCode?: string | null;
  purchaseFactor?: number;
  saleUnitId?: string | null;
  saleUnitCode?: string | null;
  saleFactor?: number;
  isManufactured?: boolean;
}

export interface StockRow {
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  productId: string;
  productCode: string;
  productName: string;
  unitCode: string;
  lotId?: string | null;
  lotCode?: string | null;
  expiresOn?: string | null;
  qualityStatus?: QualityStatus | null;
  quantity: number;
  reserved: number;
  available: number;
  avgCost: number;
  value: number;
}

export interface KardexRow {
  movementId: string;
  number: string;
  movementDate: string;
  postedAt: string;
  conceptName: string;
  status: string;
  lotCode: string | null;
  lineNo: number;
  qtyIn: number;
  qtyOut: number;
  unitCost: number;
  balance: number;
  avgCost: number;
  counterpart: string | null;
}

export interface Alerts {
  stock: {
    warehouseCode: string;
    warehouseName: string;
    productId: string;
    productCode: string;
    productName: string;
    unitCode: string;
    quantity: number;
    minQty: number;
    maxQty: number | null;
    kind: "below_min" | "above_max";
  }[];
  lots: {
    lotId: string;
    lotCode: string;
    expiresOn: string;
    daysLeft: number;
    kind: "expired" | "expiring";
    qualityStatus: QualityStatus;
    productCode: string;
    productName: string;
    unitCode: string;
    quantity: number;
  }[];
}

export const QUALITY_LABEL: Record<QualityStatus, string> = {
  quarantine: "Cuarentena",
  approved: "Liberado",
  rejected: "Rechazado",
  on_hold: "Retenido"
};
export const QUALITY_COLOR: Record<QualityStatus, string> = {
  quarantine: "yellow",
  approved: "teal",
  rejected: "red",
  on_hold: "orange"
};
export const DIRECTION_LABEL: Record<Direction, string> = { in: "Entrada", out: "Salida", transfer: "Traslado" };
export const DIRECTION_COLOR: Record<Direction, string> = { in: "teal", out: "red", transfer: "blue" };
export const RELATION_LABEL: Record<string, string> = {
  substitute: "Sustituto",
  complementary: "Complementario",
  equivalent: "Equivalente"
};
export const WAREHOUSE_KIND_LABEL: Record<string, string> = {
  storage: "Almacenamiento",
  production: "Producción",
  transit: "Tránsito"
};
