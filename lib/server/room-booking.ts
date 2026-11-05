import "server-only";

import type { RoomBookingDto } from "@/lib/contracts/room-booking";
import type { PublicRoomDto, RoomWorkspaceDto } from "@/lib/contracts/room-workspace";
import { isUuid } from "@/lib/domain/identifiers";
import { isSecureSecretValue } from "@/lib/security/secret-configuration";

const HIDDEN: RoomBookingDto = { status: "hidden" };

// Runtime configuration: launching booking does not require rebuilding browser JS.
export async function getRoomBooking(
  room: RoomWorkspaceDto | PublicRoomDto,
): Promise<RoomBookingDto> {
  if (!("id" in room) || !isUuid(room.id)) return HIDDEN;
  if (process.env.ROOM_BOOKING_ENABLED !== "true") return HIDDEN;

  const origin = bookingOrigin(process.env.ROOM_BOOKING_ORIGIN);
  const secret = process.env.ROOM_BOOKING_SHARED_SECRET?.trim();
  if (!origin || !isSecureSecretValue(secret)) return HIDDEN;

  try {
    const endpoint = new URL("/api/inventory", origin);
    endpoint.searchParams.set("roomId", room.id);
    const response = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${secret}`, Accept: "application/json" },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(1500),
    });
    if (!response.ok) return HIDDEN;
    const data: unknown = await response.json();
    if (!data || typeof data !== "object" || !("enabled" in data) || data.enabled !== true ||
        !("bookingUrl" in data) || typeof data.bookingUrl !== "string") return HIDDEN;

    const href = new URL(data.bookingUrl);
    // Only the configured booking service and this exact imported room are allowed.
    if (href.origin !== origin || href.username || href.password || href.hash ||
        href.pathname !== "/" || href.searchParams.size !== 1 ||
        href.searchParams.get("room") !== `tmc_${room.id}`) return HIDDEN;
    return { status: "available", href: href.href };
  } catch {
    // Booking outages must never prevent an Inventory QR page from opening.
    return HIDDEN;
  }
}

function bookingOrigin(value: string | undefined): string | null {
  try {
    if (!value?.trim()) return null;
    const url = new URL(value.trim());
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    const localHttp = process.env.NODE_ENV !== "production" && url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    return url.protocol === "https:" || localHttp ? url.origin : null;
  } catch {
    return null;
  }
}
