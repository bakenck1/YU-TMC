import type { ReactNode } from "react";

import { requireAuthenticatedPage } from "@/lib/server/security/page-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ProtectedLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requireAuthenticatedPage();
  return children;
}
