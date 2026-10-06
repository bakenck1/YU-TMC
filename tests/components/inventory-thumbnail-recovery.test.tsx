import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import InventoryThumbnail from "@/components/InventoryThumbnail";

vi.mock("@/components/AppSettingsProvider", () => ({ useAppSettings: () => ({ t: (key: string) => key }) }));
const photo = "/api/inventory/items/11111111-1111-4111-8111-111111111111/photo";

describe("recovering a failed inventory thumbnail", () => {
  it("retries without navigating the enclosing item row", () => {
    const navigate = vi.fn();
    render(<div onClick={navigate}><InventoryThumbnail photo={photo} /></div>);
    fireEvent.error(screen.getByAltText("items.photoAlt"));
    expect(screen.queryByAltText("items.photoAlt")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "items.photoAlt: error.retry" }));
    expect(new URL(screen.getByAltText("items.photoAlt").getAttribute("src")!, window.location.origin).pathname).toBe(photo);
    expect(navigate).not.toHaveBeenCalled();
  });
  it("does not show a photo count for an item without photos", () => {
    render(<InventoryThumbnail />);
    expect(screen.queryByText("1")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
  it("clears an old failure when the row receives a different photo", () => {
    const view = render(<InventoryThumbnail photo={photo} />);
    fireEvent.error(screen.getByAltText("items.photoAlt"));
    view.rerender(<InventoryThumbnail photo={`${photo}?photoId=new`} />);
    expect(screen.getByAltText("items.photoAlt").getAttribute("src")).toContain("photoId=new");
  });
});
