import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { BinaryBitmap, HybridBinarizer, QRCodeReader, RGBLuminanceSource } from "@zxing/library";

import RoomQrPrintPage from "@/app/inventory/rooms/qr-print/page";
import RoomQrBatchPrintView from "@/components/RoomQrBatchPrintView";
import config from "../../next.config";

const { authorize, listBuildings, listRooms } = vi.hoisted(() => ({ authorize: vi.fn(), listBuildings: vi.fn(), listRooms: vi.fn() }));
vi.mock("@/lib/server/security/page-access", () => ({ requireAuthorizedPage: authorize }));
vi.mock("@/lib/server/security/request-user", () => ({ authorizationActor: (user: unknown) => user }));
vi.mock("@/lib/server/application", () => ({ getApplicationServices: () => ({ locations: { listBuildings, listRooms } }) }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("not_found"); } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: "attacker.invalid", "x-forwarded-host": "attacker.invalid", "x-forwarded-proto": "http" }) }));
vi.mock("@/lib/campus-directory", () => ({ isInventoryBuildingName: () => true }));
vi.mock("@/components/AppSettingsProvider", () => ({ useAppSettings: () => ({ t: (key: string) => key }) }));

const room = { id: "11111111-1111-4111-8111-111111111111", buildingId: "building", designation: "101",
  floorNumber: 1, floorLabel: null, qrCode: "qU3rC3oD3A4b5c6D7e8f9g0H1i2J3k4L5", status: "active" as const,
  version: 1, createdAt: "2026-10-02T00:00:00Z", updatedAt: "2026-10-02T00:00:00Z" };

describe("adversarial typography print integration", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_PUBLIC_ORIGIN", "https://inventory.yu.edu.kz");
    authorize.mockResolvedValue({ userId: "printer", role: "typography" });
    listBuildings.mockResolvedValue([{ id: "building", name: "Main building" }]);
    listRooms.mockResolvedValue([room]);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("decodes an actual generated label to the trusted HTTPS origin despite hostile forwarded headers", async () => {
    const page = await RoomQrPrintPage({ searchParams: Promise.resolve({ all: "1" }) });
    const svg = Buffer.from(page.props.qrImages[room.id].split(",")[1], "base64");
    const { data, info } = await sharp(svg).flatten({ background: "white" }).greyscale().raw().toBuffer({ resolveWithObject: true });
    const source = new RGBLuminanceSource(new Uint8ClampedArray(data), info.width, info.height);
    const decoded = new QRCodeReader().decode(new BinaryBitmap(new HybridBinarizer(source)));
    expect(decoded.getText()).toBe(`https://inventory.yu.edu.kz/rooms/qr/${room.qrCode}`);
  });

  it("passes data SVG directly through the actual Next Image component under the application CSP", async () => {
    const page = await RoomQrPrintPage({ searchParams: Promise.resolve({ all: "1" }) });
    const markup = renderToStaticMarkup(<RoomQrBatchPrintView {...page.props} />);
    const document = new DOMParser().parseFromString(markup, "text/html");
    const image = document.querySelector("img");
    expect(image?.getAttribute("src")).toBe(page.props.qrImages[room.id]);
    expect(image?.getAttribute("srcset")).toBeNull();
    expect(image?.getAttribute("loading")).toBe("eager");
    expect(markup).not.toContain("/_next/image");
    const rules = await config.headers!();
    const csp = rules.flatMap((rule) => rule.headers).find((header) => header.key === "Content-Security-Policy")!.value;
    expect(csp.split(";").find((directive) => directive.trim().startsWith("img-src "))!.split(/\s+/)).toContain("data:");
  });

  it("does not disclose or print rooms merely because their IDs appear in the URL", async () => {
    await expect(RoomQrPrintPage({ searchParams: Promise.resolve({ ids: "22222222-2222-4222-8222-222222222222" }) })).rejects.toThrow("not_found");
  });
});
