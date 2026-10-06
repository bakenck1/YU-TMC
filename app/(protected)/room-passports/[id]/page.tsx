import { notFound } from "next/navigation";
import RoomPassportCard from "@/components/RoomPassportCard";
import type { RoomPassportDto } from "@/lib/contracts/room-passports";
import { ApplicationError } from "@/lib/domain/application-error";
import { getApplicationServices } from "@/lib/server/application";
import { requireAuthorizedPage } from "@/lib/server/security/page-access";
import { authorizationActor } from "@/lib/server/security/request-user";
import { passportReturnHref, type PassportSearchParams } from "@/lib/room-passport-list-state";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export default async function RoomPassportPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<PassportSearchParams> }) {
  const user = await requireAuthorizedPage("/room-passports");
  const { id } = await params;
  let passport: RoomPassportDto;
  try {
    passport = await getApplicationServices().passports.find(id, authorizationActor(user));
  } catch (error) {
    if (error instanceof ApplicationError && error.kind === "not_found") notFound();
    throw error;
  }
  return <RoomPassportCard key={id} initialPassport={passport} viewerId={user.userId} returnHref={passportReturnHref((await searchParams).returnTo)} />;
}
