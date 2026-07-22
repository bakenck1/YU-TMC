import { users } from "@/lib/data";
import type { UserRole } from "@/lib/types";

const ROLE_STYLES: Record<UserRole, string> = {
  Админ: "bg-green-100 text-green-700 ring-1 ring-inset ring-green-600/20",
  Кладовщик: "bg-sky-100 text-sky-700 ring-1 ring-inset ring-sky-600/20",
  Сотрудник: "bg-zinc-100 text-zinc-600 ring-1 ring-inset ring-zinc-500/20",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export default function UsersPage() {
  return (
    <div className="overflow-x-auto rounded-2xl border border-black/5 bg-white">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead>
          <tr className="border-b border-black/5 text-xs uppercase tracking-wide text-zinc-400">
            <th className="px-4 py-3 font-medium">ФИО</th>
            <th className="px-4 py-3 font-medium">Роль</th>
            <th className="px-4 py-3 font-medium">Email</th>
            <th className="px-4 py-3 font-medium">Дата добавления</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id} className="border-b border-black/5 last:border-0 hover:bg-zinc-50">
              <td className="px-4 py-3 font-medium text-zinc-800">{user.fullName}</td>
              <td className="px-4 py-3">
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${ROLE_STYLES[user.role]}`}
                >
                  {user.role}
                </span>
              </td>
              <td className="px-4 py-3 text-zinc-500">{user.email}</td>
              <td className="px-4 py-3 text-zinc-500">{formatDate(user.addedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
