import InventoryExportButton from "@/components/InventoryExportButton";
import { DEFAULT_INVENTORY_COLUMNS } from "@/lib/inventory-columns";
import { fireEvent,render,screen,waitFor } from "@testing-library/react";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";

vi.mock("@/components/AppSettingsProvider", () => ({ useAppSettings: () => ({ t: (key: string) => key }) }));

const downloads: { name: string; url: string }[] = [];
let exportedBlob: Blob | undefined;
beforeEach(() => {
  downloads.length = 0;
  exportedBlob = undefined;
  vi.stubGlobal("URL", class extends URL {
    static createObjectURL(blob: Blob) { exportedBlob = blob; return "blob:test-workbook"; }
    static revokeObjectURL() {}
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push({ name: this.download, url: this.href });
  });
});
afterEach(() => vi.unstubAllGlobals());
function view() {
  return render(<InventoryExportButton dataset="items" itemIds={["item-a"]} columns={DEFAULT_INVENTORY_COLUMNS} />);
}

describe("inventory workbook download", () => {
  it("blocks duplicate exports while pending and downloads the returned workbook", async () => {
    let finish!: (response: Response) => void;
    let payload: unknown;
    vi.stubGlobal("fetch", (_input: unknown, init: RequestInit) => {
      payload = JSON.parse(String(init.body));
      return new Promise<Response>((resolve) => { finish = resolve; });
    });
    view();
    fireEvent.click(screen.getByRole("button"));
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
    finish(new Response(new Uint8Array([80, 75, 3, 4]), { status: 200 }));
    await waitFor(() => expect(downloads).toEqual([{ name: "inventory-items.xlsx", url: "blob:test-workbook" }]));
    expect(exportedBlob?.size).toBe(4);
    expect(payload).toMatchObject({ dataset: "items", itemIds: ["item-a"] });
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(false);
  });

  it("reports a failed export without downloading and lets the user retry", async () => {
    let failed = true;
    vi.stubGlobal("fetch", async () => failed
      ? Response.json({ error: "unavailable" }, { status: 503 })
      : new Response("workbook", { status: 200 }));
    view();
    fireEvent.click(screen.getByRole("button"));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(downloads).toEqual([]);
    failed = false;
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(downloads).toHaveLength(1));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
