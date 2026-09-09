import { expect, test, type Page, type TestInfo } from "@playwright/test";

const password = requiredEnvironment("BROWSER_SMOKE_PASSWORD");
const adminEmail = requiredEnvironment("BROWSER_SMOKE_ADMIN_EMAIL");
const ownerEmail = requiredEnvironment("BROWSER_SMOKE_OWNER_EMAIL");
const recipientEmail = requiredEnvironment("BROWSER_SMOKE_RECIPIENT_EMAIL");
const inventoryNumber = requiredEnvironment("BROWSER_SMOKE_INVENTORY_NUMBER");

test.describe.serial("critical production journeys", () => {
  test("login persists across refresh and logout revokes protected access", async ({ page }, testInfo) => {
    const evidence = captureSafeEvidence(page);
    try {
      await login(page, adminEmail);
      await page.goto("/profile");
      await expect(page).toHaveURL(/\/profile$/);
      await expect(page.getByRole("heading", { name: "Browser Smoke Administrator" })).toBeVisible();

      await page.reload();
      await expect(page).toHaveURL(/\/profile$/);
      await expect(page.getByRole("heading", { name: "Browser Smoke Administrator" })).toBeVisible();

      await logout(page);
      await page.goto("/profile");
      await expect(page).toHaveURL(/\/login(?:\?|$)/);
    } finally {
      await attachSafeEvidence(testInfo, evidence);
    }
  });

  test("owner requests a transfer and the recipient accepts it", async ({ page }, testInfo) => {
    const evidence = captureSafeEvidence(page);
    try {
      await login(page, ownerEmail);
      await page.goto("/tmc/issue");

      const scanner = page.getByRole("dialog", { name: "Сканировать штрих-код" });
      await scanner.getByLabel("Или введите код вручную").fill(inventoryNumber);
      await scanner.getByRole("button", { name: "Добавить" }).click();
      await expect(page.getByText("Browser Smoke Laptop", { exact: true })).toBeVisible();

      const recipientPicker = page.getByRole("combobox", { name: "Новый ответственный" });
      await recipientPicker.fill("Browser Smoke Recipient");
      await page.getByRole("option", { name: /Browser Smoke Recipient/ }).click();
      await page.getByRole("button", { name: "Отправить заявку" }).click();

      const requestLink = page.getByRole("link", { name: "Заявка отправлена. Открыть заявку" });
      await expect(requestLink).toBeVisible();
      const requestPath = await requestLink.getAttribute("href");
      expect(requestPath).toMatch(/^\/tmc\/transfer-requests\/[0-9a-f-]{36}$/);

      await logout(page);
      await login(page, recipientEmail);
      await page.goto(requestPath!);
      await expect(page.getByRole("heading", { name: "Групповая заявка" })).toBeVisible();
      await page.getByRole("button", { name: "Принять все" }).click();
      await expect(page.getByRole("status").filter({ hasText: "Принято 1 из 1" })).toBeVisible();
      await expect(page.getByText("Принята", { exact: true })).toBeVisible();
    } finally {
      await attachSafeEvidence(testInfo, evidence);
    }
  });
});

async function login(page: Page, email: string) {
  await page.goto("/login?manual=1");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Пароль", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
}

async function logout(page: Page) {
  await page.getByRole("button", { name: "Выход", exact: true }).click();
  await expect(page).toHaveURL(/\/login(?:\?|$)/);
}

function captureSafeEvidence(page: Page) {
  const requestIds = new Set<string>();
  const trace: Array<{ method: string; path: string; status: number; requestId?: string }> = [];
  page.on("response", (response) => {
    const requestId = response.headers()["x-request-id"];
    if (requestId && /^[a-zA-Z0-9._:-]{1,128}$/.test(requestId)) requestIds.add(requestId);
    if (trace.length < 200) {
      const url = new URL(response.url());
      trace.push({
        method: response.request().method(),
        path: url.pathname,
        status: response.status(),
        ...(requestId && /^[a-zA-Z0-9._:-]{1,128}$/.test(requestId) ? { requestId } : {}),
      });
    }
  });
  return { requestIds, trace };
}

async function attachSafeEvidence(
  testInfo: TestInfo,
  evidence: ReturnType<typeof captureSafeEvidence>,
) {
  await testInfo.attach("request-ids", {
    body: Buffer.from(JSON.stringify([...evidence.requestIds].sort(), null, 2)),
    contentType: "application/json",
  });
  await testInfo.attach("safe-browser-trace", {
    body: Buffer.from(JSON.stringify(evidence.trace, null, 2)),
    contentType: "application/json",
  });
}

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
