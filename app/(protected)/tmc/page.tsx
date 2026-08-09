import TmcLanding from "@/components/TmcLanding";
import { requireAuthorizedPage } from "@/lib/server/security/page-access";
import { TMC_ENTRY_POINT } from "@/lib/tmc-navigation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function TmcPage() {
  await requireAuthorizedPage(TMC_ENTRY_POINT.href);
  return <TmcLanding />;
}
