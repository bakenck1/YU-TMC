import { notFound } from "next/navigation";
import ItemDetails from "@/components/ItemDetails";
import { items } from "@/lib/data";

export default async function ItemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const item = items.find((entry) => entry.id === id);

  if (!item) notFound();

  return <ItemDetails item={item} />;
}
