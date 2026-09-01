import Link from "next/link";
import LocalBarcodeDistributionPanel from "@/components/LocalBarcodeDistributionPanel";
import Wrapper from "@/components/Wrapper";
import type { LocalBarcodeDistributionDto } from "@/lib/contracts/local-barcodes";
import type { UserRole } from "@/lib/contracts/users";

export interface OriginalBarcodeDistributionViewProps {
  distribution: LocalBarcodeDistributionDto;
  actorId: string;
  actorRole: UserRole;
}

export default function OriginalBarcodeDistributionView({
  distribution,
  actorId,
  actorRole,
}: OriginalBarcodeDistributionViewProps) {
  const canOpenItem =
    actorRole !== "employee" || distribution.originalResponsible?.id === actorId;

  return (
    <Wrapper direction="column" gap="md">
      <section className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-medium text-emerald-700">Исходный штрихкод 1С</p>
        <h1 className="mt-1 text-2xl font-bold">{distribution.itemName}</h1>
        <p className="mt-2 font-mono text-lg">{distribution.originalBarcode}</p>
        {canOpenItem ? (
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
        actorId={actorId}
        actorRole={actorRole}
      />
    </Wrapper>
  );
}
