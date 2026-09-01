import { notFound } from "next/navigation";
import OriginalBarcodeDistributionView from "@/components/OriginalBarcodeDistributionView";
import { isUuid } from "@/lib/domain/identifiers";
import { getApplicationServices } from "@/lib/server/application";
import { readHiddenPageResource } from "@/lib/server/security/hidden-page-resource";
import { requireAuthorizedPage } from "@/lib/server/security/page-access";
import { authorizationActor } from "@/lib/server/security/request-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function OriginalBarcodeDistributionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireAuthorizedPage(`/local-barcodes/item/${id}`);
  if (!isUuid(id)) notFound();
  const distribution = await readHiddenPageResource(
    () =>
      getApplicationServices().localBarcodes.getDistribution(
        id,
        authorizationActor(user),
      ),
    notFound,
  );

  return <OriginalBarcodeDistributionView distribution={distribution} actorId={user.userId} actorRole={user.role} />;
}
