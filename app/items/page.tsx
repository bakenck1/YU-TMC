import ItemsTable from "@/components/ItemsTable";
import { items } from "@/lib/data";

export default function ItemsPage() {
  return <ItemsTable items={items} />;
}
