export const DOCKFLOW_CLEARANCE_STATUSES = [
  "CLEAR",
  "ASSETS_ASSIGNED",
  "HANDOVER_IN_PROGRESS",
  "RETURN_IN_PROGRESS",
  "LOSS_PAYMENT_PENDING",
  "ACCOUNTING_REVIEW_PENDING",
  "BLOCKED",
] as const;

export type DockflowClearanceStatus =
  (typeof DOCKFLOW_CLEARANCE_STATUSES)[number];

export const DOCKFLOW_ITEM_STATUSES = [
  "ASSIGNED",
  "TRANSFER_PENDING",
  "RETURN_PENDING",
  "LOST",
  "PAYMENT_PENDING",
  "RECEIPT_SUBMITTED",
  "ACCOUNTING_VERIFIED",
] as const;

export type DockflowItemStatus = (typeof DOCKFLOW_ITEM_STATUSES)[number];

export const DOCKFLOW_STATUS_PRIORITY: readonly DockflowClearanceStatus[] = [
  "BLOCKED",
  "ACCOUNTING_REVIEW_PENDING",
  "LOSS_PAYMENT_PENDING",
  "RETURN_IN_PROGRESS",
  "HANDOVER_IN_PROGRESS",
  "ASSETS_ASSIGNED",
  "CLEAR",
];

export interface DockflowEmployeeItem {
  id: string;
  name: string;
  inventoryNumber: string;
  quantity: number;
  condition: string;
  unitPrice: string;
  assignedAt: string;
  status: DockflowItemStatus;
  location: { building: string; room: string };
}

export interface DockflowEmployeeClearance {
  employee: {
    id: string;
    iin: string;
    fullName: string;
    email: string;
  };
  canProceed: boolean;
  clearanceStatus: DockflowClearanceStatus;
  message: string;
  summary: {
    activeItems: number;
    pendingTransfers: number;
    pendingReturns: number;
    lostItems: number;
    pendingAccountingReviews: number;
    totalAmount: string;
    currency: "KZT";
  };
  items: DockflowEmployeeItem[];
}

export interface DockflowApiKeyMetadata {
  id: string;
  name: string;
  keyPrefix: string;
  status: "active" | "revoked";
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface DockflowAuditSettings {
  retentionDays: number;
  includeKeyPrefix: boolean;
}

export function normalizeDockflowFullName(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLocaleLowerCase("ru-RU");
}

export function normalizeDockflowEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidDockflowIin(value: string): boolean {
  return /^[0-9]{12}$/.test(value);
}

export function isValidDockflowEmail(value: string): boolean {
  const email = normalizeDockflowEmail(value);
  return (
    email.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  );
}

export function highestDockflowStatus(
  statuses: Iterable<DockflowClearanceStatus>,
): DockflowClearanceStatus {
  const available = new Set(statuses);
  return (
    DOCKFLOW_STATUS_PRIORITY.find((status) => available.has(status)) ?? "CLEAR"
  );
}

export function dockflowStatusMessage(status: DockflowClearanceStatus): string {
  return {
    CLEAR: "Обязательства по ТМЦ отсутствуют",
    ASSETS_ASSIGNED: "За сотрудником числятся незакрытые ТМЦ",
    HANDOVER_IN_PROGRESS: "Передача ТМЦ ожидает подтверждения",
    RETURN_IN_PROGRESS: "Сдача ТМЦ на склад не завершена",
    LOSS_PAYMENT_PENDING: "Оплата или чек по утраченной ТМЦ не подтверждены",
    ACCOUNTING_REVIEW_PENDING: "Чек ожидает проверки бухгалтером",
    BLOCKED: "Обнаружено незакрытое или противоречивое обязательство",
  }[status];
}
