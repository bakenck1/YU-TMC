// Authentication for this route group is enforced by the adjacent layout.
import SettingsForm from "@/components/SettingsForm";
import Wrapper from "@/components/Wrapper";
import { requireAuthorizedPage } from "@/lib/server/security/page-access";
import Link from "next/link";

export default async function SettingsPage() {
  await requireAuthorizedPage("/settings");
  return (
    <Wrapper display="flex" direction="column" gap="lg">
      <SettingsForm />
      <Link href="/settings/integrations/1c" className="max-w-2xl rounded-2xl border border-black/5 bg-white p-6 text-[#002060] hover:border-blue-200">
        <span className="font-semibold">Интеграция 1С: сверка основных средств</span>
        <span className="mt-1 block text-sm text-zinc-500">Анализ снимков, разрешение конфликтов и контролируемая публикация</span>
      </Link>
    </Wrapper>
  );
}
