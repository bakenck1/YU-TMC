import { notFound } from "next/navigation";
import RoomWorkspaceView from "@/components/RoomWorkspaceView";
import { ApplicationError } from "@/lib/domain/application-error";
import { getApplicationServices } from "@/lib/server/application";
import { requireAuthenticatedPage } from "@/lib/server/security/page-access";
import { authorizationActor } from "@/lib/server/security/request-user";
import type { RoomWorkspaceDto } from "@/lib/contracts/room-workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function RoomPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  const { id } = await params;
  const user = await requireAuthenticatedPage();
  let room: RoomWorkspaceDto;
  try {
    room = await getApplicationServices().rooms.findById(id, authorizationActor(user));
  } catch (error) {
    if (error instanceof ApplicationError && error.kind === "not_found") notFound();
    throw error;
  }
  const requestedReturnTo = (await searchParams).returnTo;
  const backTo = requestedReturnTo === "/scan" ? "/scan" : undefined;
  return <RoomWorkspaceView room={room} authenticated returnTo={`/rooms/${id}`} backTo={backTo} />;
}
