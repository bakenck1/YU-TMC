// Authentication for this route group is enforced by the adjacent layout.
import ItemsTable from "@/components/ItemsTable";
import { items } from "@/lib/data";
import { requireAuthorizedPage } from "@/lib/server/security/page-access";

export default async function ItemsPage() {
  await requireAuthorizedPage("/items");
  return <ItemsTable items={items} />;
}
