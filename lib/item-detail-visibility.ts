export type LegacyItemDetailTab =
  | "info"
  | "edit"
  | "service"
  | "writeoff"
  | "delete";

const READ_ONLY_TABS: readonly LegacyItemDetailTab[] = ["info"];
const MANAGEMENT_TABS: readonly LegacyItemDetailTab[] = [
  "info",
  "edit",
  "service",
  "writeoff",
  "delete",
];

export function legacyItemDetailVisibility(canManage: boolean) {
  return {
    tabs: canManage ? MANAGEMENT_TABS : READ_ONLY_TABS,
    canGenerateQr: canManage,
  };
}
