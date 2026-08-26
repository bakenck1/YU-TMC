import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import InventoryItemCreateForm from "@/components/InventoryItemCreateForm";
import InventoryInspectionsManager from "@/components/InventoryInspectionsManager";
import InventoryRoomFormModal from "@/components/InventoryRoomFormModal";
import type {
  BuildingDto,
  RoomDto,
} from "@/lib/contracts/inventory-locations";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/components/AppSettingsProvider", () => ({
  useAppSettings: () => ({
    language: "ru",
    locale: "ru-RU",
    t: (key: string) => key,
  }),
}));

vi.mock("@/components/PushNotificationControl", () => ({
  default: () => null,
}));

const BUILDING: BuildingDto = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Test building",
  address: "Campus",
  qrCode: "YUQ1:BUILDING",
  roomCount: 0,
  status: "active",
  version: 1,
  createdAt: "2026-08-25T00:00:00.000Z",
  updatedAt: "2026-08-25T00:00:00.000Z",
};

const ROOM: RoomDto = {
  id: "22222222-2222-4222-8222-222222222222",
  buildingId: BUILDING.id,
  designation: "101",
  floorNumber: 1,
  floorLabel: null,
  primaryResponsible: null,
  qrCode: "YUQ1:ROOM",
  status: "active",
  version: 1,
  createdAt: "2026-08-25T00:00:00.000Z",
  updatedAt: "2026-08-25T00:00:00.000Z",
};

describe("inventory setup actions", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("creates a room when no responsible employee exists yet", async () => {
    const onSave = vi.fn();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void init;
      if (String(input) === "/api/users") {
        return { ok: true, json: async () => ({ users: [] }) } as Response;
      }
      return { ok: true, json: async () => ({ room: ROOM }) } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <InventoryRoomFormModal
        building={BUILDING}
        room={null}
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );

    fireEvent.change(screen.getByLabelText("inventory.roomDesignation"), {
      target: { value: "101" },
    });
    const saveButton = screen.getByRole("button", { name: "common.save" });
    expect((saveButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(saveButton);

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(ROOM));
    const createCall = fetchMock.mock.calls.find(([input]) =>
      String(input).includes(`/api/inventory/buildings/${BUILDING.id}/rooms`),
    );
    expect(createCall).toBeDefined();
    const request = createCall?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({
      designation: "101",
      floorNumber: 1,
      primaryResponsibleId: null,
    });
  });

  it("shows why item creation is unavailable before the first room exists", () => {
    render(<InventoryItemCreateForm rooms={[]} />);

    expect(
      (screen.getByRole("button", { name: "createItem.add" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.getByRole("status").textContent).toContain("createItem.noRooms");
  });

  it("marks every field that blocks item creation as required", () => {
    render(<InventoryItemCreateForm rooms={[ROOM]} openInitially />);

    const nameInput = screen.getByLabelText(/items\.name/);
    const typeInput = screen.getByLabelText(/items\.type/);
    const roomSelect = screen.getByLabelText(/itemDetails\.room/);

    expect((nameInput as HTMLInputElement).required).toBe(true);
    expect((typeInput as HTMLInputElement).required).toBe(true);
    expect((roomSelect as HTMLSelectElement).required).toBe(true);
    expect(nameInput.closest("label")?.textContent).toContain(
      "createItem.required",
    );
    expect(typeInput.closest("label")?.textContent).toContain(
      "createItem.required",
    );
  });

  it("explains how to add an inspection assignee when none exist", () => {
    render(
      <InventoryInspectionsManager
        actorRole="admin"
        currentUserId="33333333-3333-4333-8333-333333333333"
        initialInspections={[]}
        initialInspectionId={null}
        rooms={[ROOM]}
        technicians={[]}
        canExport={false}
      />,
    );

    expect(screen.getByRole("status").textContent).toContain(
      "inspections.noTechnicians",
    );
    expect(
      (screen.getByLabelText("inspections.assignee") as HTMLSelectElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", {
        name: "inspections.create",
      }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      screen.getByRole("link", { name: "inspections.manageUsers" }).getAttribute(
        "href",
      ),
    ).toBe("/users");
  });
});
