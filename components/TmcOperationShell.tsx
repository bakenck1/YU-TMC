"use client";

import TmcItemQrFlow from "@/components/TmcItemQrFlow";
import type { TmcOperationNavigation } from "@/lib/tmc-navigation";

export default function TmcOperationShell({
  operation,
}: {
  operation: TmcOperationNavigation;
}) {
  return <TmcItemQrFlow operation={operation} />;
}
