import UserProfileCard from "@/components/UserProfileCard";
import { getApplicationServices } from "@/lib/server/application";
import { requireAuthorizedPage } from "@/lib/server/security/page-access";

export default async function ProfilePage() {
  const currentUser = await requireAuthorizedPage("/profile");
  const profile = await getApplicationServices().users.getProfile(currentUser.userId);
  return <UserProfileCard profile={profile} />;
}
