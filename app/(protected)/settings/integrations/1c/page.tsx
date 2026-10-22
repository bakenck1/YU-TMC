import { redirect } from "next/navigation";
import { requireAuthorizedPage } from "@/lib/server/security/page-access";

export const dynamic="force-dynamic";
export default async function OneCIntegrationPage(){
  await requireAuthorizedPage("/settings/integrations/1c");
  redirect("/integrations/1c");
}
