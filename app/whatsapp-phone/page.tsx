import { redirect } from "next/navigation";
import WhatsAppPhoneForm from "@/components/WhatsAppPhoneForm";
import { defaultPathForRole } from "@/lib/security/authorization";
import { requireAuthenticatedPage } from "@/lib/server/security/page-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function WhatsAppPhonePage() {
  const user = await requireAuthenticatedPage({ allowPhoneSetup: true });
  if (!user.whatsappPhoneRequired) redirect(defaultPathForRole(user.role));
  return <WhatsAppPhoneForm />;
}
