import { notFound } from "next/navigation";
import LocalBarcodeGroupDetails from "@/components/LocalBarcodeGroupDetails";
import { isUuid } from "@/lib/domain/identifiers";
import { getApplicationServices } from "@/lib/server/application";
import { readHiddenPageResource } from "@/lib/server/security/hidden-page-resource";
import { requireAuthorizedPage } from "@/lib/server/security/page-access";
import { authorizationActor } from "@/lib/server/security/request-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function LocalBarcodePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireAuthorizedPage(`/local-barcodes/${id}`);
  if (!isUuid(id)) notFound();
  const actor = authorizationActor(user);
  const [group, history] = await readHiddenPageResource(
    () =>
      Promise.all([
        getApplicationServices().localBarcodes.getGroup(id, actor),
        getApplicationServices().localBarcodes.getHistory(id, actor),
      ]),
    notFound,
  );

  return (
    <LocalBarcodeGroupDetails
      group={group}
      history={history}
      actorId={user.userId}
      actorRole={user.role}
    />
  );
}
