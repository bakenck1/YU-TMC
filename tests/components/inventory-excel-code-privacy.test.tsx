import { Workbook } from "exceljs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/inventory/excel/route";
import type { InventoryItemDto } from "@/lib/contracts/inventory-items";
import { hasPermission, type AuthorizationActor } from "@/lib/security/permissions";
import { STORY_ITEM_DTO } from "@/stories/inventory-fixtures";

const mocks = vi.hoisted(() => ({
  currentUser: vi.fn(), listItems: vi.fn(), listItItems: vi.fn(), listDecommissionedItems: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/security/request-user", () => ({
  requireCurrentUser: mocks.currentUser,
  authorizationActor: (user: AuthorizationActor) => user,
}));
vi.mock("@/lib/server/application", () => ({
  getApplicationServices: () => ({ items: {
    listItems: mocks.listItems, listItItems: mocks.listItItems, listDecommissionedItems: mocks.listDecommissionedItems,
  } }),
}));

const URL = "https://inventory.test/api/inventory/excel";
const ID = "11111111-1111-4111-8111-111111111111";
const CODE = "00003254";
const CODE_HEADER = "1C code (material statement)";
const ITEM: InventoryItemDto = { ...STORY_ITEM_DTO, id: ID, name: "Laptop", oneCCode: CODE, inventoryNumber: "2411/00388" };

beforeEach(() => {
  // The route must enforce privacy even if its upstream source contains a code.
  mocks.listItems.mockResolvedValue([ITEM]);
  mocks.listItItems.mockResolvedValue([{ ...ITEM, itemSection: "it", itType: "camera" }]);
  mocks.listDecommissionedItems.mockResolvedValue([
    { ...ITEM, status: "decommissioned" }, { ...ITEM, status: "decommissioned_in_use" },
  ]);
});

async function readExport(response: Response) {
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  const workbook = new Workbook();
  await workbook.xlsx.load(await response.arrayBuffer());
  const sheet = workbook.worksheets[0]!;
  const headers = Array.from({ length: sheet.columnCount }, (_, index) => sheet.getCell(1, index + 1).text);
  const values: unknown[] = [];
  sheet.eachRow((row) => row.eachCell((cell) => values.push(cell.value)));
  return { sheet, headers, values };
}

function authenticate(role: AuthorizationActor["role"]) {
  mocks.currentUser.mockResolvedValue({ userId: "admin-or-warehouse", role, sessionVersion: 1 });
}

describe("administrator-only 1C codes in inventory Excel routes", () => {
  for (const dataset of ["items", "decommissioned", "decommissioned_in_use", "it-items"]) {
    it(`warehouse GET export ${dataset} never exposes the code or its column`, async () => {
      authenticate("warehouse");
      const response = await GET(new Request(`${URL}?action=export&dataset=${dataset}`));
      if (dataset === "it-items" && !hasPermission("warehouse", "inventory.it.read")) {
        expect(response.status).toBe(403);
        return;
      }
      const { headers, values } = await readExport(response);
      expect(headers).not.toContain(CODE_HEADER);
      expect(values).not.toContain(CODE);
      expect(values).toContain("2411/00388");
    });
  }

  for (const dataset of ["items", "decommissioned", "decommissioned_in_use"]) {
    it(`administrator GET export ${dataset} retains the exact code zeroes`, async () => {
      authenticate("admin");
      const { sheet, headers } = await readExport(await GET(new Request(`${URL}?action=export&dataset=${dataset}`)));
      expect(headers).toContain(CODE_HEADER);
      expect(sheet.getCell(2, headers.indexOf(CODE_HEADER) + 1).value).toBe(CODE);
    });
  }

  for (const columns of [undefined, ["name", "inventoryNumber", "oneCCode"]]) {
    it(`warehouse POST cannot request a hidden code with ${columns ? "crafted" : "default"} columns`, async () => {
      authenticate("warehouse");
      const request = new Request(`${URL}?action=export`, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ dataset: "items", itemIds: [ID], ...(columns ? { columns } : {}) }) });
      const { headers, values } = await readExport(await POST(request));
      expect(headers).not.toContain(CODE_HEADER);
      expect(values).not.toContain(CODE);
      expect(values).toContain("2411/00388");
    });
  }

  it("administrator POST can request the code with its leading zeroes", async () => {
    authenticate("admin");
    const request = new Request(`${URL}?action=export`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ dataset: "items", itemIds: [ID], columns: ["name", "oneCCode"] }) });
    const { sheet, headers } = await readExport(await POST(request));
    expect(sheet.getCell(2, headers.indexOf(CODE_HEADER) + 1).value).toBe(CODE);
  });

  for (const role of ["employee", "typography"] as const) {
    it(`${role} cannot export codes using either GET or POST`, async () => {
      authenticate(role);
      const responses = [await GET(new Request(`${URL}?action=export&dataset=items`)),
        await POST(new Request(`${URL}?action=export`, { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ dataset: "items", columns: ["name", "oneCCode"] }) }))];
      for (const response of responses) {
        expect(response.status).toBe(403);
        expect(await response.json()).toEqual({ error: "forbidden" });
      }
      expect(mocks.listItems).not.toHaveBeenCalled();
    });
  }
});
