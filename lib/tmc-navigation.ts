import type { TranslationKey } from "@/lib/i18n";

export const TMC_ENTRY_POINT = {
  href: "/tmc",
  labelKey: "tmc.entryPoint",
} as const satisfies { href: string; labelKey: TranslationKey };

export const TMC_OPERATION_BY_ID = {
  receive: {
    id: "receive",
    href: "/tmc/receive",
    labelKey: "tmc.operation.receive",
  },
  issue: {
    id: "issue",
    href: "/tmc/issue",
    labelKey: "tmc.operation.issue",
  },
  transfer: {
    id: "transfer",
    href: "/tmc/transfer",
    labelKey: "tmc.operation.transfer",
  },
} as const satisfies Record<
  string,
  { id: string; href: string; labelKey: TranslationKey }
>;

export const TMC_OPERATIONS = [
  TMC_OPERATION_BY_ID.receive,
  TMC_OPERATION_BY_ID.issue,
  TMC_OPERATION_BY_ID.transfer,
] as const;

export type TmcOperationNavigation = (typeof TMC_OPERATIONS)[number];
