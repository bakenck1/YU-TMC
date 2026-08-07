import QrScanPage from "@/components/QrScanPage";
import { requireAuthenticatedPage } from "@/lib/server/security/page-access";

export const dynamic = "force-dynamic";

export default async function ScanPage() {
  await requireAuthenticatedPage();
  return <QrScanPage />;
}
