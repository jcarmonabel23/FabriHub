/**
 * @project FabriHub - Front
 * @file src/app/purchases/types.ts
 * @description Modelos de Compras y Calidad
 */

export type OrderStatus = "draft" | "pending_approval" | "approved" | "partially_received" | "received" | "closed" | "cancelled";

export interface Contact {
  id: string;
  name: string;
  position: string | null;
  phone: string | null;
  email: string | null;
  isPrimary: boolean;
}

export interface Supplier {
  id: string;
  code: string;
  legalName: string;
  tradeName: string | null;
  rif: string;
  phones: string[];
  email: string | null;
  address: string | null;
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
  buyerId: string | null;
  buyerName: string | null;
  priceListId: string | null;
  priceListCode: string | null;
  fiscalTreatmentId: string | null;
  fiscalTreatmentCode: string | null;
  currencyId: string | null;
  currencyCode: string | null;
  payableAccount: string | null;
  expenseAccount: string | null;
  openOrders: number;
  contacts?: Contact[];
}

export interface PriceList {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  currencyId: string;
  currencyCode: string;
  validFrom: string | null;
  validTo: string | null;
  notes: string | null;
  items: number;
  parties: number;
}

export interface PriceListItem {
  productId: string;
  productCode: string;
  productName: string;
  unitCode: string;
  price: number;
  promoPrice: number | null;
  promoFrom: string | null;
  promoTo: string | null;
  promoActive: boolean;
}

export interface OrderLine {
  id: string;
  lineNo: number;
  productId: string;
  productCode: string;
  productName: string;
  isLotControlled: boolean;
  isStockable: boolean;
  shelfLifeDays: number | null;
  unitId: string;
  unitCode: string;
  unitFactor: number;
  stockUnitCode: string;
  quantity: number;
  unitPrice: number;
  discountPct: number;
  treatmentCode: string | null;
  taxRate: number;
  netAmount: number;
  taxAmount: number;
  quantityReceived: number;
  quantityPending: number;
  expectedDate: string | null;
  notes: string | null;
}

export interface TaxLine {
  rate: number;
  base: number;
  amount: number;
}

export interface WithholdingLine {
  rateId: string;
  label: string;
  baseOn: "amount" | "tax";
  base: number;
  amount: number;
  bracket: { fromAmount: number; rate: number; subtrahend: number } | null;
}

export interface Order {
  id: string;
  number: string;
  status: OrderStatus;
  orderDate: string;
  expectedDate: string | null;
  supplierId: string;
  supplierCode: string;
  supplierName: string;
  supplierRif: string;
  contactId: string | null;
  contactName: string | null;
  buyerId: string | null;
  buyerName: string | null;
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
  payable: number;
  taxesDetail: { taxes: TaxLine[]; withholdings: WithholdingLine[] };
  supplierReference: string | null;
  notes: string | null;
  cancelReason: string | null;
  createdById: string | null;
  createdBy: string | null;
  createdAt: string;
  submittedAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  closedBy: string | null;
  closedAt: string | null;
}

export interface OrderReceptionRef {
  id: string;
  number: string;
  kind: "receipt" | "return";
  status: "posted" | "cancelled";
  receptionDate: string;
  deliveryNote: string | null;
  movementNumber: string | null;
  createdBy: string | null;
  lines: number;
}

export interface OrderDetail extends Order {
  lines: OrderLine[];
  receptions: OrderReceptionRef[];
}

export interface Preview {
  exchangeRate: number;
  currencyId: string;
  lines: { productId: string; unitPrice: number; priceSource: string | null; taxRate: number; net: number; tax: number }[];
  totals: {
    subtotal: number;
    discountAmount: number;
    taxableAmount: number;
    taxes: TaxLine[];
    taxAmount: number;
    total: number;
    withholdings: WithholdingLine[];
    withholdingAmount: number;
    payable: number;
  };
}

export interface Reception {
  id: string;
  number: string;
  kind: "receipt" | "return";
  status: "posted" | "cancelled";
  receptionDate: string;
  deliveryNote: string | null;
  exchangeRate: number;
  notes: string | null;
  purchaseOrderId: string;
  orderNumber: string;
  orderStatus: OrderStatus;
  supplierName: string;
  warehouseCode: string;
  movementId: string | null;
  movementNumber: string | null;
  currencyCode: string;
  returnedReceptionId: string | null;
  returnedReceptionNumber: string | null;
  createdBy: string | null;
  createdAt: string;
  cancelledBy: string | null;
  cancelledAt: string | null;
  totalCost: number;
}

export interface ReceptionDetail extends Reception {
  lines: {
    id: string;
    lineNo: number;
    poLineId: string;
    productCode: string;
    productName: string;
    unitCode: string;
    stockUnitCode: string;
    quantity: number;
    stockQuantity: number;
    unitCost: number;
    lotId: string | null;
    lotCode: string | null;
    lotStatus: string | null;
    expiresOn: string | null;
    supplierLot: string | null;
    returned: number;
  }[];
}

export interface QualityLot {
  id: string;
  internalNumber: number;
  lotCode: string;
  qualityStatus: "quarantine" | "approved" | "rejected" | "on_hold";
  productId: string;
  productCode: string;
  productName: string;
  unitCode: string;
  receivedOn: string | null;
  expiresOn: string | null;
  manufacturedOn: string | null;
  supplierLot: string | null;
  supplierName: string | null;
  orderNumber: string | null;
  movementNumber: string | null;
  originConcept: string | null;
  createdById: string | null;
  createdBy: string | null;
  quantity: number;
  lastDecision: { toStatus: string; notes: string; analysisRef: string | null; decidedAt: string; decidedBy: string } | null;
}

export interface QualityLotDetail extends QualityLot {
  events: { id: string; fromStatus: string; toStatus: string; analysisRef: string | null; notes: string; decidedBy: string; decidedAt: string }[];
}

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  draft: "Borrador",
  pending_approval: "Por aprobar",
  approved: "Aprobada",
  partially_received: "Recepción parcial",
  received: "Recibida",
  closed: "Cerrada",
  cancelled: "Anulada"
};

export const ORDER_STATUS_COLOR: Record<OrderStatus, string> = {
  draft: "gray",
  pending_approval: "yellow",
  approved: "blue",
  partially_received: "orange",
  received: "teal",
  closed: "dark",
  cancelled: "red"
};
