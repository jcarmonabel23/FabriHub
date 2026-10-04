/**
 * @project FabriHub - Front
 * @file src/app/sales/types.ts
 * @description Modelos de Ventas (espejo de api/src/modules/sales)
 */

import type { Contact, TaxLine, WithholdingLine } from "@/app/purchases/types";

export type SalesOrderStatus = "draft" | "pending_approval" | "confirmed" | "partially_delivered" | "delivered" | "closed" | "cancelled";

export const SO_STATUS_LABEL: Record<SalesOrderStatus, string> = {
  draft: "Borrador",
  pending_approval: "Retenida por crédito",
  confirmed: "Confirmada",
  partially_delivered: "Despacho parcial",
  delivered: "Despachada",
  closed: "Cerrada",
  cancelled: "Anulada"
};

export const SO_STATUS_COLOR: Record<SalesOrderStatus, string> = {
  draft: "gray",
  pending_approval: "yellow",
  confirmed: "blue",
  partially_delivered: "orange",
  delivered: "teal",
  closed: "dark",
  cancelled: "red"
};

export interface Customer {
  id: string;
  code: string;
  legalName: string;
  tradeName: string | null;
  rif: string;
  phones: string[];
  email: string | null;
  address: string | null;
  deliveryAddress: string | null;
  city: string | null;
  state: string | null;
  country: string;
  notes: string | null;
  isActive: boolean;
  paymentTermId: string | null;
  paymentTermName: string | null;
  deliveryTermId: string | null;
  deliveryMethodId: string | null;
  zoneId: string | null;
  zoneName: string | null;
  businessTypeId: string | null;
  businessTypeName: string | null;
  sellerId: string | null;
  sellerName: string | null;
  priceListId: string | null;
  priceListCode: string | null;
  fiscalTreatmentId: string | null;
  fiscalTreatmentCode: string | null;
  currencyId: string | null;
  currencyCode: string | null;
  isWithholdingAgent: boolean;
  creditLimit: number | null;
  creditUsed: number;
  receivableAccount: string | null;
  incomeAccount: string | null;
  openOrders: number;
  contacts?: Contact[];
}

export interface Reservation {
  lotId: string | null;
  lotCode: string | null;
  expiresOn: string | null;
  quantity: number;
}

export interface SalesOrderLine {
  id: string;
  lineNo: number;
  productId: string;
  productCode: string;
  productName: string;
  isLotControlled: boolean;
  isStockable: boolean;
  unitId: string;
  unitCode: string;
  unitFactor: number;
  stockUnitCode: string;
  quantity: number;
  unitPrice: number;
  priceSource: string | null;
  discountPct: number;
  treatmentCode: string | null;
  taxRate: number;
  netAmount: number;
  taxAmount: number;
  quantityDelivered: number;
  quantityPending: number;
  quantityReserved: number;
  available: number;
  reservations: Reservation[];
  notes: string | null;
}

export interface SalesOrder {
  id: string;
  number: string;
  status: SalesOrderStatus;
  orderDate: string;
  requestedDate: string | null;
  customerId: string;
  customerCode: string;
  customerName: string;
  customerRif: string;
  customerIsAgent: boolean;
  creditLimit: number | null;
  contactId: string | null;
  contactName: string | null;
  sellerId: string | null;
  sellerName: string | null;
  warehouseId: string;
  warehouseCode: string;
  deliveryAddress: string | null;
  currencyId: string;
  currencyCode: string;
  currencySymbol: string;
  exchangeRate: number;
  paymentTermId: string | null;
  paymentTermName: string | null;
  deliveryTermId: string | null;
  deliveryMethodId: string | null;
  discountPct: number;
  subtotal: number;
  discountAmount: number;
  taxableAmount: number;
  taxAmount: number;
  total: number;
  withholdingAmount: number;
  receivable: number;
  taxesDetail: { taxes: TaxLine[]; withholdings: WithholdingLine[] };
  customerReference: string | null;
  notes: string | null;
  cancelReason: string | null;
  creditExposure: number | null;
  confirmedAt: string | null;
  createdById: string | null;
  createdBy: string | null;
  createdAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  closedBy: string | null;
  closedAt: string | null;
  isLate: boolean;
}

export interface Backorder {
  lineNo: number;
  productCode: string;
  pending: number;
  reserved: number;
  missing: number;
}

export interface SalesOrderDetail extends SalesOrder {
  lines: SalesOrderLine[];
  deliveries: { id: string; number: string; status: "posted" | "cancelled"; deliveryDate: string; carrier: string | null; movementNumber: string | null; createdBy: string | null; netAmount: number; lines: number }[];
  backorder?: Backorder[];
  creditHold?: boolean;
}

export interface DeliveryLot {
  soLineId: string;
  lotId: string | null;
  lotCode: string | null;
  expiresOn: string | null;
  capacity: number;
}

export interface Delivery {
  id: string;
  number: string;
  status: "posted" | "cancelled";
  deliveryDate: string;
  carrier: string | null;
  deliveryAddress: string | null;
  notes: string | null;
  netAmount: number;
  costAmount: number;
  salesOrderId: string;
  orderNumber: string;
  orderStatus: SalesOrderStatus;
  currencyCode: string;
  exchangeRate: number;
  customerId: string;
  customerName: string;
  customerRif: string;
  warehouseId: string;
  warehouseCode: string;
  movementId: string | null;
  movementNumber: string | null;
  createdBy: string | null;
  createdAt: string;
  cancelledBy: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
}

export interface DeliveryDetail extends Delivery {
  lines: {
    id: string;
    lineNo: number;
    soLineId: string;
    productCode: string;
    productName: string;
    unitCode: string;
    stockUnitCode: string;
    quantity: number;
    stockQuantity: number;
    unitPrice: number;
    unitCost: number;
    lotId: string | null;
    lotCode: string | null;
    expiresOn: string | null;
  }[];
}

export interface PendingSalesOrder {
  id: string;
  number: string;
  status: SalesOrderStatus;
  orderDate: string;
  requestedDate: string | null;
  customerName: string;
  warehouseCode: string;
  pendingLines: number;
  isLate: boolean;
}

export interface LotTrace {
  lot: { id: string; lotCode: string; productCode: string; productName: string; unitCode: string; expiresOn: string | null; qualityStatus: string; productionOrderNumber: string | null; supplierName: string | null };
  deliveries: { id: string; number: string; status: string; deliveryDate: string; orderNumber: string; customerCode: string; customerName: string; customerRif: string; phones: string[]; email: string | null; quantity: number }[];
}
