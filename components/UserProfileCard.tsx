import type { UserDto } from "@/lib/contracts/users";
import UserAccountDetailsCard from "./UserAccountDetailsCard";
import UserEmailVerificationCard from "./UserEmailVerificationCard";
import UserProfileHeader from "./UserProfileHeader";
import UserProfileRoleCard from "./UserProfileRoleCard";

export default function UserProfileCard({ profile }: { profile: UserDto }) {
  return (
    <section className="mx-auto max-w-5xl space-y-6" aria-label="Профиль пользователя">
      <UserProfileHeader profile={profile} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <UserAccountDetailsCard profile={profile} />
        <aside className="space-y-4">
          <UserProfileRoleCard role={profile.role} />
          <UserEmailVerificationCard verified={profile.emailVerified} />
        </aside>
      </div>
    </section>
  );
}
