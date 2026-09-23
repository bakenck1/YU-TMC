import Link from "next/link";

export default function DecommissionedRegistryTabs({
  active,
  inventoryTotal,
  oneCTotal,
}: {
  active: "inventory" | "one-c";
  inventoryTotal: number | null;
  oneCTotal: number | null;
}) {
  const tabClass = (selected: boolean) => selected
    ? "rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white"
    : "rounded-xl px-4 py-2.5 text-sm font-medium text-zinc-600 hover:bg-zinc-100";

  return (
    <nav aria-label="Источники списанных ОС" className="flex flex-wrap gap-2 rounded-2xl border border-black/5 bg-white p-2 shadow-sm">
      <Link className={tabClass(active === "inventory")} href="/items/decommissioned">
        Списанные в Inventory{inventoryTotal === null ? "" : ` (${inventoryTotal.toLocaleString("ru-RU")})`}
      </Link>
      {oneCTotal !== null && (
        <Link className={tabClass(active === "one-c")} href="/items/decommissioned?source=one-c">
          Списанные по данным 1С ({oneCTotal.toLocaleString("ru-RU")})
        </Link>
      )}
    </nav>
  );
}
