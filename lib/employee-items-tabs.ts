import type { ItemStatus } from "@/lib/contracts/inventory-domain";

export const EMPLOYEE_ITEM_STATUSES = [
  "active",
  "maintenance",
  "decommissioned",
] as const satisfies readonly ItemStatus[];

export type EmployeeItemTabKey =
  | "ArrowLeft"
  | "ArrowRight"
  | "Home"
  | "End";

export function employeeItemTabAfterKey(
  current: ItemStatus,
  key: string,
): ItemStatus | null {
  const currentIndex = EMPLOYEE_ITEM_STATUSES.indexOf(current);
  if (currentIndex === -1) return null;

  switch (key as EmployeeItemTabKey) {
    case "ArrowLeft":
      return EMPLOYEE_ITEM_STATUSES[
        (currentIndex - 1 + EMPLOYEE_ITEM_STATUSES.length) %
          EMPLOYEE_ITEM_STATUSES.length
      ];
    case "ArrowRight":
      return EMPLOYEE_ITEM_STATUSES[
        (currentIndex + 1) % EMPLOYEE_ITEM_STATUSES.length
      ];
    case "Home":
      return EMPLOYEE_ITEM_STATUSES[0];
    case "End":
      return EMPLOYEE_ITEM_STATUSES[EMPLOYEE_ITEM_STATUSES.length - 1];
    default:
      return null;
  }
}

export function employeeItemsForStatus<TItem extends { status: ItemStatus }>(
  items: readonly TItem[],
  status: ItemStatus,
): TItem[] {
  return items.filter((item) => item.status === status);
}
