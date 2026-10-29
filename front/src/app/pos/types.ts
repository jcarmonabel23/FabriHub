/**
 * @project FabriHub - Front
 * @file src/app/pos/types.ts
 * @description Tipos del punto de venta: cajas, turnos, venta y comprobantes
 */

export interface PosTerminal {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  priceListId: string | null;
  priceListCode: string | null;
  priceListName: string | null;
  defaultCustomerId: string | null;
  defaultCustomerName: string | null;
  ticketPrefix: string;
  ticketPadding: number;
  nextTicket: number;
  notes: string | null;
  openSessionId: string | null;
  openSessionNumber: string | null;
  openSessionCashier: string | null;
  updatedAt: string;
}

export interface PosTerminalInput {
  code: string;
  name: string;
  warehouseId: string;
  priceListId: string | null;
  defaultCustomerId: string | null;
  ticketPrefix?: string;
  ticketPadding: number;
  notes: string | null;
  isActive: boolean;
}

export type PaymentMethod = "cash" | "card" | "mobile" | "transfer";

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: "Efectivo",
  card: "Punto de venta",
  mobile: "Pago móvil",
  transfer: "Transferencia"
};

// ------------------------------------------------------------------ Turnos

export interface PosCurrency {
  id: string;
  code: string;
  name: string;
  symbol: string | null;
  isBase: boolean;
  /** Tasa a moneda base de hoy (la base = 1) */
  rate: number;
}

export interface PosSettings {
  maxDiscountPct: number;
  igtfEnabled: boolean;
  igtfRate: number;
}

export interface CountRow {
  method: PaymentMethod;
  currencyId: string;
  currencyCode: string;
  isBase: boolean;
  opening: number;
  received: number;
  change: number;
  expected: number;
  counted: number | null;
  difference: number | null;
}

export interface PosSession {
  id: string;
  number: string;
  status: "open" | "closed";
  terminalId: string;
  terminalCode: string;
  terminalName: string;
  warehouseId: string;
  warehouseCode: string;
  cashierId: string;
  cashierName: string;
  openedAt: string;
  closedAt: string | null;
  closedByName: string | null;
  salesCount: number | null;
  salesTotal: number | null;
  differenceTotal: number | null;
  openingNotes: string | null;
  closingNotes: string | null;
}

export interface PosSessionDetail extends PosSession {
  counts: CountRow[];
  totals: { completed: number; voided: number; grandTotal: number; taxAmount: number; igtfAmount: number };
}

export interface PosMe {
  session: PosSessionDetail | null;
  terminals: { id: string; code: string; name: string; warehouseCode: string; priceListName: string | null; isBusy: boolean }[];
  currencies: PosCurrency[];
  settings: PosSettings;
}

// ------------------------------------------------------------------ Venta

export interface CatalogItem {
  id: string;
  code: string;
  name: string;
  barcode: string | null;
  image: { thumb: string; medium: string; full: string } | null;
  isStockable: boolean;
  unitId: string;
  unitCode: string;
  unitFactor: number;
  /** Precio sin IVA, en moneda base (null = sin precio) */
  price: number | null;
  isPromo: boolean | null;
  taxRate: number;
  /** Disponible en la unidad de venta (null = no inventariable) */
  available: number | null;
}

export interface PosCustomer {
  id: string;
  code: string;
  name: string;
  rif: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  isFinalConsumer: boolean;
}

export interface CartLine {
  productId: string;
  code: string;
  name: string;
  unitId: string;
  unitCode: string;
  thumb: string | null;
  quantity: number;
  discountPct: number;
  /** Solo para avisar en pantalla: quien valida es el servidor */
  available: number | null;
}

export interface PaymentInput {
  method: PaymentMethod;
  currencyId: string;
  amount: number;
  reference?: string | null;
}

export interface SupervisorInput {
  userId: string;
  pin: string;
}

export interface QuoteInput {
  sessionId: string;
  customerId?: string | null;
  discountPct: number;
  lines: { productId: string; unitId: string; quantity: number; discountPct: number }[];
  payments?: PaymentInput[];
  changeCurrencyId?: string | null;
}

export interface SaleInput extends QuoteInput {
  payments: PaymentInput[];
  supervisor?: SupervisorInput | null;
  notes?: string | null;
}

export interface Quote {
  customer: PosCustomer;
  terminalCode: string;
  lines: {
    lineNo: number;
    productId: string;
    productCode: string;
    productName: string;
    unitId: string;
    unitCode: string;
    quantity: number;
    unitPrice: number;
    priceSource: string | null;
    discountPct: number;
    taxRate: number;
    netAmount: number;
    taxAmount: number;
  }[];
  subtotal: number;
  discountAmount: number;
  taxableAmount: number;
  taxes: { rate: number; base: number; amount: number }[];
  taxAmount: number;
  total: number;
  igtf: { rate: number; base: number; amount: number };
  grandTotal: number;
  payments: { method: PaymentMethod; currencyId: string; amount: number; exchangeRate: number; amountBase: number }[];
  paid: number;
  pending: number;
  change: number;
  changeCurrencyId: string;
  changeInCurrency: number;
  maxDiscountPct: number;
  needsSupervisor: boolean;
}

// ------------------------------------------------------------------ Comprobantes

export interface PosSaleRow {
  id: string;
  ticketNumber: string;
  status: "completed" | "voided";
  saleDate: string;
  soldAt: string;
  terminalCode: string;
  sessionNumber: string;
  customerName: string;
  customerRif: string;
  grandTotal: number;
  cashierName: string | null;
  methods: string | null;
}

export interface PosSale {
  id: string;
  ticketNumber: string;
  status: "completed" | "voided";
  saleDate: string;
  soldAt: string;
  terminalCode: string;
  terminalName: string;
  sessionId: string;
  sessionNumber: string;
  warehouseCode: string;
  priceListName: string | null;
  customerName: string;
  customerRif: string;
  currencyCode: string;
  discountPct: number;
  subtotal: number;
  discountAmount: number;
  taxableAmount: number;
  taxAmount: number;
  total: number;
  igtfRate: number;
  igtfAmount: number;
  grandTotal: number;
  paidAmount: number;
  changeAmount: number;
  changeCurrencyCode: string | null;
  changeInCurrency: number | null;
  movementNumber: string | null;
  notes: string | null;
  cashierName: string | null;
  discountAuthorizedBy: string | null;
  voidedAt: string | null;
  voidedByName: string | null;
  voidAuthorizedBy: string | null;
  voidReason: string | null;
  taxesDetail: { taxes?: { rate: number; base: number; amount: number }[] } | null;
  lines: {
    lineNo: number;
    productCode: string;
    productName: string;
    unitCode: string;
    quantity: number;
    unitPrice: number;
    discountPct: number;
    taxRate: number;
    netAmount: number;
    taxAmount: number;
  }[];
  payments: { lineNo: number; method: PaymentMethod; currencyCode: string; amount: number; exchangeRate: number; amountBase: number; reference: string | null }[];
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
