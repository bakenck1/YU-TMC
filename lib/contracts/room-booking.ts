export type RoomBookingDto =
  | { status: "coming_soon" }
  | { status: "available"; href: string }
  | { status: "hidden" };
