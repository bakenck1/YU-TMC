import QrScanPage from "@/components/QrScanPage";
import { requireAuthenticatedPage } from "@/lib/server/security/page-access";

export const dynamic = "force-dynamic";

export default async function ScanPage() {
  const user = await requireAuthenticatedPage();
  return <QrScanPage actorRole={user.role} />;
}
