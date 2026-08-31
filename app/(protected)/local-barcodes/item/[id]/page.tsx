import Link from "next/link";
import { notFound } from "next/navigation";
import LocalBarcodeDistributionPanel from "@/components/LocalBarcodeDistributionPanel";
import Wrapper from "@/components/Wrapper";
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

  return (
    <Wrapper direction="column" gap="md">
      <section className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-medium text-emerald-700">Исходный штрихкод 1С</p>
        <h1 className="mt-1 text-2xl font-bold">{distribution.itemName}</h1>
        <p className="mt-2 font-mono text-lg">{distribution.originalBarcode}</p>
        {user.role !== "employee" ||
        distribution.originalResponsible?.id === user.userId ? (
          <Link
            href={`/items/${distribution.itemId}`}
            className="mt-4 inline-flex min-h-11 items-center rounded-xl border border-zinc-200 px-4 font-semibold"
          >
            Полная карточка ТМЦ
          </Link>
        ) : null}
      </section>
      <LocalBarcodeDistributionPanel
        itemId={distribution.itemId}
        actorId={user.userId}
        actorRole={user.role}
      />
    </Wrapper>
  );
}
