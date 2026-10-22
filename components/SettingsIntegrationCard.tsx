import Link from "next/link";

export default function SettingsIntegrationCard() {
  return (
    <Link
      href="/integrations/1c"
      className="max-w-2xl rounded-2xl border border-black/5 bg-white p-6 text-[#002060] hover:border-blue-200"
    >
      <span className="font-semibold">
        Интеграция 1С: аналитика и сверка
      </span>
      <span className="mt-1 block text-sm text-zinc-500">
        Отдельный раздел: основные средства, материалы и сравнение с Inventory
      </span>
    </Link>
  );
}
