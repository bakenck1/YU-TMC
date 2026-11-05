import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import RoomBookingCard from "@/components/RoomBookingCard";
import RoomWorkspaceView from "@/components/RoomWorkspaceView";
import type { VisibleRoomWorkspaceDto } from "@/lib/contracts/room-workspace";

const room: VisibleRoomWorkspaceDto = {
  access: "full",
  id: "11111111-1111-4111-8111-111111111111",
  designation: "201 · Студенческий офис",
  buildingName: "Главный кампус",
  floorNumber: 2,
  responsibleName: null,
  items: [],
};
const available = { status: "available", href: `https://booking.example/?room=tmc_${room.id}` } as const;

const meta = {
  title: "Catalog/Room booking",
  component: RoomBookingCard,
  parameters: { layout: "padded", nextjs: { appDirectory: false } },
} satisfies Meta<typeof RoomBookingCard>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ComingSoon: Story = { args: { booking: { status: "coming_soon" } } };
export const Available: Story = { args: { booking: available } };
export const RoomBeforeLaunch: Story = {
  render: () => <RoomWorkspaceView room={room} authenticated returnTo="/rooms/qr/demo" booking={{ status: "hidden" }} />,
};
export const RoomWithBooking: Story = {
  render: () => <RoomWorkspaceView room={room} authenticated returnTo="/rooms/qr/demo" booking={available} />,
};
