import UserProfileCard from "@/components/UserProfileCard";
import { toInventoryItemView } from "@/lib/inventory-item-view";
import { toLocalBarcodeInventoryItem } from "@/lib/local-barcode-item-view";
import { getApplicationServices } from "@/lib/server/application";
import { requireAuthorizedPage } from "@/lib/server/security/page-access";
import { authorizationActor } from "@/lib/server/security/request-user";

export default async function ProfilePage() {
  const currentUser = await requireAuthorizedPage("/profile");
  const services = getApplicationServices();
  const actor = authorizationActor(currentUser);
  const [profile, serverItems, localGroups] = await Promise.all([
    services.users.getProfile(currentUser.userId),
    services.items.listOwnItems(actor),
    services.localBarcodes.listActiveGroupsAssignedTo(actor),
  ]);
  const originalItems = await Promise.all(
    serverItems.map(async (item) => {
      const distribution = await services.localBarcodes.getDistribution(item.id, actor);
      return {
        ...toInventoryItemView(item),
        quantity: distribution.originalRemainder,
      };
    }),
  );
  const items = [
    ...originalItems.filter((item) => item.quantity > 0),
    ...localGroups.map(toLocalBarcodeInventoryItem),
  ];
  return <UserProfileCard profile={profile} items={items} />;
}
