import { notFound } from "next/navigation";
import LocalBarcodeLabelView from "@/components/LocalBarcodeLabelView";
import { isUuid } from "@/lib/domain/identifiers";
import { getApplicationServices } from "@/lib/server/application";
import { readHiddenPageResource } from "@/lib/server/security/hidden-page-resource";
import { requireAuthorizedPage } from "@/lib/server/security/page-access";
import { authorizationActor } from "@/lib/server/security/request-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function LocalBarcodeLabelPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireAuthorizedPage(`/local-barcodes/${id}/label`);
  if (!isUuid(id)) notFound();
  const group = await readHiddenPageResource(
    () =>
      getApplicationServices().localBarcodes.getGroup(
        id,
        authorizationActor(user),
      ),
    notFound,
  );
  return <LocalBarcodeLabelView group={group} />;
}
