// Authentication for this route group is enforced by the adjacent layout.
import Dashboard from "@/components/Dashboard";
import { getApplicationServices } from "@/lib/server/application";
import { requireAuthorizedPage } from "@/lib/server/security/page-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function Home() {
  await requireAuthorizedPage("/");
  const users = await getApplicationServices().users.listUsers();
  return <Dashboard totalUsers={users.length} />;
}
