import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import InventoryBuildingsManager from "@/components/InventoryBuildingsManager";
import InventoryRoomFormModal from "@/components/InventoryRoomFormModal";
import { apartmentDesignation } from "@/lib/apartment-locations";
import type { ApartmentAddress, BuildingDto, RoomDto } from "@/lib/contracts/inventory-locations";
import { translate, type TranslationKey } from "@/lib/i18n";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/AppSettingsProvider", () => ({ useAppSettings: () => ({
  language: "ru", locale: "ru-RU", t: (key: TranslationKey, values?: Record<string,string|number>) => translate("ru",key,values),
}) }));
vi.mock("@/components/TmcUserPicker", () => ({ default: () => null }));

const building: BuildingDto = { id: "11111111-1111-4111-8111-111111111111", name: "Квартиры", address: "Актау", qrCode: "QR", roomCount: 0, status: "active", version: 1, createdAt: "", updatedAt: "" };
const address: ApartmentAddress = { microdistrict: "32", house: "12", entrance: "2", number: "18" };
function room(id: string, apartment: ApartmentAddress = address): RoomDto {
  return { id, buildingId: building.id, designation: apartmentDesignation(apartment), floorNumber: 0, floorLabel: null,
    apartment, qrCode: "QR", status: "active", version: 1, createdAt: "", updatedAt: "" };
}
function fillAddress() {
  for (const [label,value] of [["Микрорайон","32"],["Номер дома","12"],["Подъезд","2"],["Номер квартиры","18"],["Этаж","0"]]) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
}

describe("apartment creation and navigation", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("creates the first apartment from Add building in one request, without opening another room form", async () => {
    const created=room("new-apartment");
    const fetchMock=vi.fn(async (_url:unknown,init?:RequestInit) => Response.json(init?.method==="POST"?{building:{...building,roomCount:1},room:created}:{rooms:[created]}));
    vi.stubGlobal("fetch",fetchMock);
    render(<InventoryBuildingsManager actorRole="admin" initialBuildings={[]} />);
    fireEvent.click(screen.getByRole("button",{name:translate("ru","inventory.addBuilding")}));
    fireEvent.change(screen.getByLabelText("Выберите корпус"),{target:{value:"apartments"}});
    const save=screen.getByRole("button",{name:"Сохранить"}) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fillAddress();
    fireEvent.click(save);
    await waitFor(()=>expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText(created.designation)).toBeTruthy();
    const calls=fetchMock.mock.calls.filter(([,init])=>init?.method==="POST");
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe("/api/inventory/apartments");
    expect(JSON.parse(String(calls[0][1]?.body))).toEqual({apartment:address,floorNumber:0});
  });

  it("keeps a single apartment direct and groups two in the same microdistrict after saving and reload", async () => {
    const first=room("first",{...address,number:"17"});
    const second=room("second");
    let saved=false;
    vi.stubGlobal("fetch",vi.fn(async (_url:unknown,init?:RequestInit)=>{
      if(init?.method==="POST"){saved=true;return Response.json({room:second});}
      return Response.json({rooms:saved?[first,second]:[first]});
    }));
    const view=render(<InventoryBuildingsManager actorRole="admin" initialBuildings={[{...building,roomCount:1}]} />);
    fireEvent.click(screen.getByRole("button",{name:/Квартир: 1/}));
    await screen.findByText(first.designation);
    expect(screen.queryByText("32 микрорайон")).toBeNull();
    fireEvent.click(screen.getByRole("button",{name:"Добавить квартиру"}));
    fillAddress();
    fireEvent.click(screen.getByRole("button",{name:"Сохранить"}));
    const group=(await screen.findByText("32 микрорайон")).closest("details")!;
    expect(group.open).toBe(true);
    expect(within(group).getByText(first.designation)).toBeTruthy();
    expect(within(group).getByText(second.designation)).toBeTruthy();
    fireEvent.click(group.querySelector("summary")!);
    expect(group.open).toBe(false);
    fireEvent.click(group.querySelector("summary")!);
    expect(group.open).toBe(true);
    view.unmount();
    render(<InventoryBuildingsManager actorRole="admin" initialBuildings={[{...building,roomCount:2}]} />);
    fireEvent.click(screen.getByRole("button",{name:/Квартир: 2/}));
    expect((await screen.findByText("32 микрорайон")).closest("details")).toBeTruthy();
  });

  it("retains apartment fields and floor zero while editing and reports a duplicate without closing", async () => {
    const existing=room("existing");
    const saved=vi.fn();
    vi.stubGlobal("fetch",vi.fn(async()=>Response.json({error:"room_already_exists"},{status:409})));
    render(<InventoryRoomFormModal building={building} room={existing} onSave={saved} onClose={vi.fn()} />);
    expect((screen.getByLabelText("Микрорайон") as HTMLInputElement).value).toBe("32");
    expect((screen.getByLabelText("Этаж") as HTMLInputElement).value).toBe("0");
    fireEvent.click(screen.getByRole("button",{name:"Сохранить"}));
    await screen.findByText("Эта квартира уже добавлена в указанном доме и микрорайоне.");
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(saved).not.toHaveBeenCalled();
  });

  it("rebuilds a group after archiving and keeps a different microdistrict direct", async () => {
    const first=room("first",{...address,number:"17"});
    const second=room("second");
    const other=room("other",{...address,microdistrict:"11"});
    vi.spyOn(window,"confirm").mockReturnValue(true);
    vi.stubGlobal("fetch",vi.fn(async (_url:unknown,init?:RequestInit)=>init?.method==="DELETE"?new Response(null,{status:204}):Response.json({rooms:[first,second,other]})));
    render(<InventoryBuildingsManager actorRole="admin" initialBuildings={[{...building,roomCount:3}]} />);
    fireEvent.click(screen.getByRole("button",{name:/Квартир: 3/}));
    const group=(await screen.findByText("32 микрорайон")).closest("details")!;
    expect(screen.queryByText("11 микрорайон")).toBeNull();
    fireEvent.click(group.querySelector("summary")!);
    fireEvent.click(within(group).getByRole("button",{name:translate("ru","building.archiveRoom",{name:second.designation})}));
    await waitFor(()=>expect(screen.queryByText("32 микрорайон")).toBeNull());
    expect(screen.getByText(first.designation)).toBeTruthy();
    expect(screen.getByText(other.designation)).toBeTruthy();
  });
});
