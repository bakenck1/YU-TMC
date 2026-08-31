// Authentication for this route group is enforced by the adjacent layout.
import UsersManager from "@/components/UsersManager";
import { getApplicationServices } from "@/lib/server/application";
import { requireAuthorizedPage } from "@/lib/server/security/page-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const currentUser = await requireAuthorizedPage("/users");
  const services = getApplicationServices();
  const users = (await services.users.listUsersForManagement(currentUser)).map(
    (user) => ({
      ...user,
      phone: user.phone ?? "—",
    }),
  );

  return (
    <UsersManager
      initialUsers={users}
      actorRole={currentUser.role}
    />
  );
}
