import type { PublicRoomDto, RoomWorkspaceDto } from "@/lib/contracts/room-workspace";
import RoomWorkspaceView from "./RoomWorkspaceView";
import type { RoomBookingDto } from "@/lib/contracts/room-booking";

export interface PublicRoomWorkspaceScreenProps {
  room: RoomWorkspaceDto | PublicRoomDto;
  authenticated: boolean;
  returnTo: string;
  readOnly?: boolean;
  booking?: RoomBookingDto;
}

export default function PublicRoomWorkspaceScreen({ room, authenticated, returnTo, readOnly = false, booking }: PublicRoomWorkspaceScreenProps) {
  return (
    <main className="min-h-screen bg-background p-4 sm:p-6">
      <RoomWorkspaceView room={room} authenticated={authenticated} returnTo={returnTo} readOnly={readOnly} backTo={readOnly ? "/inventory" : undefined} booking={booking} />
    </main>
  );
}
