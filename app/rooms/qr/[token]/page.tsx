import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import PublicRoomWorkspaceScreen from "@/components/PublicRoomWorkspaceScreen";
import { ApplicationError } from "@/lib/domain/application-error";
import { SESSION_COOKIE_NAME } from "@/lib/security/session";
import { getApplicationServices } from "@/lib/server/application";
import {
  authorizationActor,
  resolveCurrentUserToken,
} from "@/lib/server/security/request-user";
import type {
  PublicRoomDto,
  RoomWorkspaceDto,
} from "@/lib/contracts/room-workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function PublicRoomQrPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const returnTo = `/rooms/qr/${encodeURIComponent(token)}`;
  let user: Awaited<ReturnType<typeof resolveCurrentUserToken>> | null = null;
  let room: RoomWorkspaceDto | PublicRoomDto;
  try {
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    user = sessionToken
      ? await resolveCurrentUserToken(sessionToken).catch(() => null)
      : null;
    room = user
      ? await getApplicationServices().rooms.findByQr(token, authorizationActor(user))
      : await getApplicationServices().rooms.findPublicByQr(token);
  } catch (error) {
    if (error instanceof ApplicationError && error.kind === "not_found") notFound();
    throw error;
  }
  return (
    <PublicRoomWorkspaceScreen room={room} authenticated={Boolean(user)} returnTo={returnTo} />
  );
}
