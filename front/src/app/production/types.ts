/**
 * @project FabriHub - Front
 * @file src/app/production/types.ts
 * @description Tipos de Producción (espejo de api/src/modules/production)
 */

export interface StageRef {
  id: string;
  code: string;
  name: string;
}

export interface ProductionCenter {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
  materialsWarehouseId: string | null;
  materialsWarehouseCode: string | null;
  outputWarehouseId: string | null;
  outputWarehouseCode: string | null;
  stages: StageRef[];
  workCenters: number;
}

export interface WorkCenter {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
  workCenterTypeId: string;
  typeCode: string;
  typeName: string;
  productionCenterId: string;
  productionCenterCode: string;
  productionCenterName: string;
  capacityHoursDay: number;
  efficiencyPct: number;
  laborRate: number;
  overheadRate: number;
}

export interface Route {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
  baseQuantity: number;
  productionCenterId: string | null;
  productionCenterCode: string | null;
  steps: number;
  baseHours: number;
  formulas: number;
}

export interface RouteStep {
  id: string;
  sequence: number;
  stageId: string;
  stageCode: string;
  stageName: string;
  workCenterId: string;
  workCenterCode: string;
  workCenterName: string;
  setupHours: number;
  runHours: number;
  notes: string | null;
  laborRate: number;
  overheadRate: number;
}

export interface RouteDetail extends Omit<Route, "steps"> {
  steps: RouteStep[];
}

export interface Formula {
  id: string;
  code: string;
  name: string;
  version: number;
  isDefault: boolean;
  isActive: boolean;
  baseQuantity: number;
  validFrom: string;
  notes: string | null;
  productId: string;
  productCode: string;
  productName: string;
  unitCode: string;
  routeId: string | null;
  routeCode: string | null;
  routeName: string | null;
  components: number;
  orders: number;
}

export interface FormulaLine {
  id: string;
  lineNo: number;
  componentId: string;
  componentCode: string;
  componentName: string;
  unitCode: string;
  typeCode: string;
  quantity: number;
  scrapPct: number;
  isCritical: boolean;
  stageId: string | null;
  stageCode: string | null;
  notes: string | null;
  hasFormula: boolean;
  stdCost: number;
}

export interface FormulaDetail extends Formula {
  lines: FormulaLine[];
  materialCost: number;
  materialUnitCost: number;
}

export interface ExplosionRow {
  level: number;
  path: string;
  parentId: string;
  componentId: string;
  componentCode: string;
  componentName: string;
  unitCode: string;
  typeCode: string;
  quantity: number;
  isCritical: boolean;
  hasFormula: boolean;
  available: number;
  stdCost: number;
  shortfall: number;
}

export interface Explosion {
  items: ExplosionRow[];
  materialCost: number;
  criticalShortages: number;
  shortages: number;
}

export interface ImplosionRow {
  level: number;
  path: string;
  productId: string;
  productCode: string;
  productName: string;
  productUnitCode: string;
  formulaId: string;
  formulaCode: string;
  version: number;
  isDefault: boolean;
  usedCode: string;
  usedUnitCode: string;
  quantity: number;
  baseQuantity: number;
}

export type OrderStatus = "planned" | "created" | "released" | "in_process" | "confirmed" | "closed" | "cancelled";

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  planned: "Planificada",
  created: "Creada",
  released: "Liberada",
  in_process: "En proceso",
  confirmed: "Confirmada",
  closed: "Cerrada",
  cancelled: "Anulada"
};

export const ORDER_STATUS_COLOR: Record<OrderStatus, string> = {
  planned: "gray",
  created: "blue",
  released: "violet",
  in_process: "orange",
  confirmed: "teal",
  closed: "dark",
  cancelled: "red"
};

export interface ProductionOrder {
  id: string;
  number: string;
  status: OrderStatus;
  priority: number;
  productId: string;
  productCode: string;
  productName: string;
  unitCode: string;
  isLotControlled: boolean;
  shelfLifeDays: number | null;
  formulaId: string;
  formulaCode: string;
  formulaVersion: number;
  routeId: string | null;
  routeCode: string | null;
  productionCenterId: string | null;
  productionCenterCode: string | null;
  productionCenterName: string | null;
  materialsWarehouseId: string;
  materialsWarehouseCode: string;
  outputWarehouseId: string;
  outputWarehouseCode: string;
  quantityPlanned: number;
  quantityProduced: number;
  plannedStart: string;
  plannedEnd: string | null;
  isLate: boolean;
  lotCode: string | null;
  outputLotId: string | null;
  outputLotCode: string | null;
  outputLotStatus: string | null;
  outputMovementId: string | null;
  outputMovementNumber: string | null;
  stdMaterialCost: number;
  stdLaborCost: number;
  stdOverheadCost: number;
  realMaterialCost: number | null;
  realLaborCost: number | null;
  realOverheadCost: number | null;
  realUnitCost: number | null;
  variance: number | null;
  notes: string | null;
  cancelReason: string | null;
  createdById: string | null;
  createdBy: string | null;
  createdAt: string;
  releasedBy: string | null;
  releasedAt: string | null;
  startedAt: string | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
  closedBy: string | null;
  closedAt: string | null;
  cancelledBy: string | null;
  cancelledAt: string | null;
  processesTotal: number;
  processesDone: number;
}

export interface OrderLine {
  id: string;
  lineNo: number;
  productId: string;
  productCode: string;
  productName: string;
  unitCode: string;
  isLotControlled: boolean;
  isCritical: boolean;
  warehouseId: string;
  warehouseCode: string;
  stageCode: string | null;
  quantityRequired: number;
  quantityConsumed: number;
  quantityReserved: number;
  available: number;
  stdUnitCost: number;
  consumedCost: number;
  reservations: { lotId: string | null; lotCode: string | null; expiresOn: string | null; quantity: number }[];
}

export type ProcessStatus = "pending" | "in_process" | "done";

export const PROCESS_STATUS_LABEL: Record<ProcessStatus, string> = { pending: "Pendiente", in_process: "En curso", done: "Terminada" };
export const PROCESS_STATUS_COLOR: Record<ProcessStatus, string> = { pending: "gray", in_process: "orange", done: "teal" };

export interface OrderProcess {
  id: string;
  sequence: number;
  status: ProcessStatus;
  stageCode: string;
  stageName: string;
  workCenterCode: string;
  workCenterName: string;
  stdHours: number;
  realHours: number | null;
  quantityGood: number | null;
  quantityScrap: number | null;
  laborRate: number;
  overheadRate: number;
  startedAt: string | null;
  startedBy: string | null;
  finishedAt: string | null;
  finishedBy: string | null;
  notes: string | null;
}

export interface OrderMovement {
  id: string;
  number: string;
  status: string;
  movementDate: string;
  conceptCode: string;
  conceptName: string;
  direction: string;
  warehouseCode: string;
  totalCost: number;
  lines: number;
  reversalOfId: string | null;
}

export interface Shortage {
  lineNo: number;
  productCode: string;
  required: number;
  available: number;
  shortfall: number;
  isCritical: boolean;
}

export interface ProductionOrderDetail extends ProductionOrder {
  lines: OrderLine[];
  processes: OrderProcess[];
  movements: OrderMovement[];
  shortages?: Shortage[];
}

export interface AvailabilityRow {
  id: string;
  lineNo: number;
  productCode: string;
  productName: string;
  unitCode: string;
  warehouseCode: string;
  isCritical: boolean;
  required: number;
  consumed: number;
  reserved: number;
  pending: number;
  available: number;
  availableElsewhere: number;
  shortfall: number;
}

export interface TrackingRow {
  id: string;
  sequence: number;
  status: ProcessStatus;
  orderId: string;
  orderNumber: string;
  orderStatus: OrderStatus;
  priority: number;
  productCode: string;
  productName: string;
  unitCode: string;
  quantityPlanned: number;
  plannedStart: string;
  plannedEnd: string | null;
  stageCode: string;
  stageName: string;
  workCenterId: string;
  workCenterCode: string;
  workCenterName: string;
  stdHours: number;
  realHours: number | null;
  quantityGood: number | null;
  quantityScrap: number | null;
  startedAt: string | null;
  startedBy: string | null;
  finishedAt: string | null;
  finishedBy: string | null;
  notes: string | null;
  previousPending: number;
}
