import type { PublicRoomDto, RoomWorkspaceDto } from "@/lib/contracts/room-workspace";
import RoomWorkspaceView from "./RoomWorkspaceView";

export interface PublicRoomWorkspaceScreenProps {
  room: RoomWorkspaceDto | PublicRoomDto;
  authenticated: boolean;
  returnTo: string;
}

export default function PublicRoomWorkspaceScreen({ room, authenticated, returnTo }: PublicRoomWorkspaceScreenProps) {
  return (
    <main className="min-h-screen bg-background p-4 sm:p-6">
      <RoomWorkspaceView room={room} authenticated={authenticated} returnTo={returnTo} />
    </main>
  );
}
