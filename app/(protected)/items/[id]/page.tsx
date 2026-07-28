// Authentication for this route group is enforced by the adjacent layout.
import { notFound } from "next/navigation";
import ItemDetails from "@/components/ItemDetails";
import { items } from "@/lib/data";
import { requireAuthorizedPage } from "@/lib/server/security/page-access";

export default async function ItemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireAuthorizedPage(`/items/${id}`);
  const item = items.find((entry) => entry.id === id);

  if (!item) notFound();

  return <ItemDetails item={item} />;
}
