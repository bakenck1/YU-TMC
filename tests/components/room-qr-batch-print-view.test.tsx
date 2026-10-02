import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import RoomQrBatchPrintView from "@/components/RoomQrBatchPrintView";
import type { RoomDto } from "@/lib/contracts/inventory-locations";

vi.mock("@/components/AppSettingsProvider", () => ({
  useAppSettings: () => ({ t: (key: string) => key }),
}));
vi.mock("next/image", () => ({
  default: ({ src, alt, loading, onLoad, onError }: ComponentProps<"img">) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} loading={loading} onLoad={onLoad} onError={onError} />
  ),
}));

const ROOMS: RoomDto[] = ["101", "102"].map((designation) => ({
  id: designation,
  buildingId: "building-1",
  designation,
  floorNumber: 1,
  floorLabel: null,
  qrCode: `ROOM-${designation}`,
  status: "active",
  version: 1,
  createdAt: "2026-10-02T00:00:00Z",
  updatedAt: "2026-10-02T00:00:00Z",
}));
const QR_IMAGE = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=";
const QR_IMAGES = Object.fromEntries(ROOMS.map((room) => [room.id, QR_IMAGE]));

describe("complete room QR print sheets", () => {
  beforeEach(() => { vi.spyOn(window, "print").mockImplementation(() => {}); });

  it("loads offscreen QR codes and enables printing only after every label is ready", () => {
    render(<RoomQrBatchPrintView rooms={ROOMS} qrImages={QR_IMAGES} />);
    const images = screen.getAllByRole("img");
    expect(images.map((image) => image.getAttribute("loading"))).toEqual(["eager", "eager"]);
    expect((screen.getByRole("button", { name: "room.qrLoading" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.load(images[0]);
    expect((screen.getByRole("button", { name: "room.qrLoading" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.load(images[1]);
    fireEvent.click(screen.getByRole("button", { name: "room.qrPrint" }));
    expect(window.print).toHaveBeenCalledTimes(1);
  });

  it("blocks incomplete print sheets and explains failed QR image loading", () => {
    render(<RoomQrBatchPrintView rooms={ROOMS} qrImages={QR_IMAGES} />);
    fireEvent.load(screen.getByRole("img", { name: "QR 101" }));
    fireEvent.error(screen.getByRole("img", { name: "QR 102" }));
    expect(screen.getByRole("alert").textContent).toBe("room.qrLoadError");
    expect((screen.getByRole("button", { name: "room.qrLoading" }) as HTMLButtonElement).disabled).toBe(true);
    expect(window.print).not.toHaveBeenCalled();
  });

  it("prints 125 labels without any per-room image API requests", () => {
    const rooms = Array.from({ length: 125 }, (_, index) => ({ ...ROOMS[0], id: `room-${index}`, designation: String(index) }));
    render(<RoomQrBatchPrintView rooms={rooms} qrImages={Object.fromEntries(rooms.map((room) => [room.id, QR_IMAGE]))} />);
    const images = screen.getAllByRole("img");
    expect(images).toHaveLength(125);
    expect(images.every((image) => image.getAttribute("src") === QR_IMAGE)).toBe(true);
    act(() => { for (const image of images) fireEvent.load(image); });
    const print = screen.getByRole("button", { name: "room.qrPrint" });
    expect((print as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(print);
    expect(window.print).toHaveBeenCalledTimes(1);
  });
});
