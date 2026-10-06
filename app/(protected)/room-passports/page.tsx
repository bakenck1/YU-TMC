import RoomPassportList from "@/components/RoomPassportList";
import { getApplicationServices } from "@/lib/server/application";
import { requireAuthorizedPage } from "@/lib/server/security/page-access";
import { authorizationActor } from "@/lib/server/security/request-user";
import { hasPermission } from "@/lib/security/permissions";
import { parsePassportFilters, type PassportSearchParams } from "@/lib/room-passport-list-state";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export default async function RoomPassportsPage({ searchParams }: { searchParams: Promise<PassportSearchParams> }) {
  const user = await requireAuthorizedPage("/room-passports");
  const actor = authorizationActor(user);
  return <RoomPassportList
    passports={await getApplicationServices().passports.list(actor)}
    prioritizeReview={hasPermission(actor.role, "inventory.passport.review")}
    initialFilters={parsePassportFilters(await searchParams)}
  />;
}
