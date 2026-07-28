// Authentication for this route group is enforced by the adjacent layout.
import SettingsForm from "@/components/SettingsForm";
import { requireAuthorizedPage } from "@/lib/server/security/page-access";

export default async function SettingsPage() {
  await requireAuthorizedPage("/settings");
  return <SettingsForm />;
}
