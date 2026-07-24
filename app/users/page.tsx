import { users } from "@/lib/data";
import UsersManager from "@/components/UsersManager";

export default function UsersPage() {
  return <UsersManager initialUsers={users} />;
}
