import type { TranslationKey } from "@/lib/i18n";

export const TMC_ENTRY_POINT = {
  href: "/tmc",
  labelKey: "tmc.entryPoint",
} as const satisfies { href: string; labelKey: TranslationKey };
