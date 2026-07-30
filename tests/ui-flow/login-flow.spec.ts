import { expect, test, type Page } from "@playwright/test";

const demoEmail = "ui-demo@inventory.local";
const demoPassword = "Ui-Demo-Only-2026!";
const demoBuildingName = "Демо-корпус интерфейса";
const demoRoomDesignation = "UI-101";
const demoItemName = "Демо: моноблок HP ProOne 440";

interface Building {
  id: string;
  name: string;
}

interface Room {
  id: string;
  designation: string;
}

interface Item {
  id: string;
  name: string;
}

test("captures the complete inventory UI flow", async ({ page }) => {
  await page.goto("/login");
  await expect(page.locator('input[type="email"]')).toBeVisible();
  await capture(page, "01-login");

  await page.locator('input[type="email"]').fill(demoEmail);
  await page.locator('input[autocomplete="current-password"]').fill(demoPassword);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/$/);

  const settings = await page.request.patch("/api/settings", {
    data: {
      organizationName: "YU Inventory",
      language: "ru",
      emailNotifications: true,
      pushNotifications: false,
      maintenanceAlerts: true,
    },
  });
  expect(settings.ok()).toBe(true);
  await page.reload();
  await expect(page.getByText("Главная", { exact: true })).toBeVisible();
  await capture(page, "02-dashboard-map");

  const room = await ensureDemoRoom(page);
  const item = await ensureDemoItem(page, room.id);

  await page.goto("/items");
  await expect(page.getByRole("button", { name: "Добавить предмет" })).toBeVisible();
  await capture(page, "03-inventory-list");

  await page.getByRole("button", { name: "Добавить предмет" }).click();
  await expect(page.getByRole("dialog", { name: "Добавить предмет" })).toBeVisible();
  await capture(page, "04-add-item-dialog");
  await page.getByRole("dialog", { name: "Добавить предмет" })
    .getByRole("button", { name: "Закрыть" })
    .click();

  await page.goto(`/items/${item.id}`);
  await expect(page.getByRole("heading", { name: demoItemName })).toBeVisible();
  await capture(page, "05-item-details");

  const actionBar = page.locator('nav[aria-label="Действия с предметом"]');
  await actionBar.getByRole("button", { name: "Редактировать" }).click();
  await expect(page.getByText("Карточка предмета", { exact: true })).toBeVisible();
  await capture(page, "06-edit-item");
  await page.getByRole("button", { name: "Отмена" }).click();

  await actionBar.getByRole("button", { name: "QR-код" }).click();
  await expect(page.getByRole("dialog", { name: "Генерация QR-кода" })).toBeVisible();
  await capture(page, "07-qr-generation");
  await page.getByRole("dialog", { name: "Генерация QR-кода" })
    .getByRole("button", { name: "Закрыть" })
    .click();

  await page.getByRole("button", { name: "Как сканировать QR-код?" }).click();
  await expect(page.getByRole("dialog", { name: "Как сканировать QR-код?" })).toBeVisible();
  await capture(page, "08-qr-scan-help");
  await page.getByRole("dialog", { name: "Как сканировать QR-код?" })
    .getByRole("button", { name: "Понятно" })
    .click();

  await page.getByRole("button", { name: "Для чего QR-код ТМЦ?" }).click();
  await expect(page.getByRole("dialog", { name: "Для чего QR-код ТМЦ?" })).toBeVisible();
  await capture(page, "09-qr-purpose-help");
  await page.getByRole("dialog", { name: "Для чего QR-код ТМЦ?" })
    .getByRole("button", { name: "Понятно" })
    .click();

  await actionBar.getByRole("button", { name: "В сервис" }).click();
  await expect(page.getByRole("dialog", { name: "Отправить в сервис" })).toBeVisible();
  await capture(page, "10-send-to-service");
  await page.getByRole("dialog", { name: "Отправить в сервис" })
    .getByRole("button", { name: "Отмена" })
    .click();

  await page.getByRole("button", { name: "Фото", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Фотографировать предмет" })).toBeVisible();
  await capture(page, "11-camera-capture");
  await page.getByRole("dialog", { name: "Фотографировать предмет" })
    .getByRole("button", { name: "Закрыть" })
    .click();

  await actionBar.getByRole("button", { name: "Списать" }).click();
  await expect(page.getByRole("dialog", { name: "Списать и архивировать предмет" })).toBeVisible();
  await capture(page, "12-archive-confirmation");
  await page.getByRole("dialog", { name: "Списать и архивировать предмет" })
    .getByRole("button", { name: "Отмена" })
    .click();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/items");
  await capture(page, "13-mobile-inventory-list");
});

async function capture(page: Page, name: string) {
  await page.screenshot({ path: `artifacts/ui-flow/${name}.png`, fullPage: true });
}

async function ensureDemoRoom(page: Page): Promise<Room> {
  const buildingsResponse = await page.request.get("/api/inventory/buildings");
  expect(buildingsResponse.ok()).toBe(true);
  const buildings = (await buildingsResponse.json()).buildings as Building[];
  let building = buildings.find((candidate) => candidate.name === demoBuildingName);
  if (!building) {
    const created = await page.request.post("/api/inventory/buildings", {
      data: {
        name: demoBuildingName,
        address: "32-й микрорайон, демонстрационная зона",
      },
    });
    expect(created.ok()).toBe(true);
    building = (await created.json()).building as Building;
  }
  const roomsResponse = await page.request.get(
    `/api/inventory/buildings/${building.id}/rooms`,
  );
  expect(roomsResponse.ok()).toBe(true);
  const rooms = (await roomsResponse.json()).rooms as Room[];
  const existing = rooms.find((room) => room.designation === demoRoomDesignation);
  if (existing) return existing;
  const created = await page.request.post(
    `/api/inventory/buildings/${building.id}/rooms`,
    { data: { designation: demoRoomDesignation, floorNumber: 1 } },
  );
  expect(created.ok()).toBe(true);
  return (await created.json()).room as Room;
}

async function ensureDemoItem(page: Page, roomId: string): Promise<Item> {
  const listResponse = await page.request.get("/api/inventory/items");
  expect(listResponse.ok()).toBe(true);
  const items = (await listResponse.json()).items as Item[];
  const existing = items.find((item) => item.name === demoItemName);
  if (existing) return existing;
  const created = await page.request.post("/api/inventory/items", {
    data: {
      name: demoItemName,
      description: "Демонстрационный предмет для проверки интерфейса.",
      itemType: "Моноблок",
      brand: "HP",
      model: "ProOne 440 G9",
      quantity: 1,
      unitPrice: 389000,
      roomId,
      inventoryNumber: "UI-DEMO-0001",
    },
  });
  expect(created.ok()).toBe(true);
  return (await created.json()).item as Item;
}
