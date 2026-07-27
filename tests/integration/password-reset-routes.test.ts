import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as forgotPassword } from "@/app/api/auth/forgot-password/route";
import { POST as resetPassword } from "@/app/api/auth/reset-password/route";
import { POST as register } from "@/app/api/auth/register/route";
import { POST as login } from "@/app/api/auth/login/route";
import {
  commitPasswordResetCode,
  createPasswordResetCode,
  verifyAndConsumePasswordResetCode,
} from "@/lib/security/password-reset";
import { verifyPasswordCredentials } from "@/lib/security/credentials";
import {
  createAuthTestDirectory,
  removeAuthTestDirectory,
  resetAuthTestEnvironment,
  uniqueRequest,
} from "../helpers/auth-test-environment";

const directory = createAuthTestDirectory();
const EMAIL = "admin@example.com";
const OLD_PASSWORD = "Correct-Horse-Battery-2026!";
const NEW_PASSWORD = "Replacement-Password-2026!";

function jsonRequest(pathname: string, body: unknown, ip?: string) {
  return uniqueRequest(
    pathname,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    ip,
  );
}

function forgotRequest(email = EMAIL, ip?: string) {
  return jsonRequest("/api/auth/forgot-password", { email }, ip);
}

function resetRequest(
  code: string,
  password = NEW_PASSWORD,
  email = EMAIL,
  ip?: string,
) {
  return jsonRequest("/api/auth/reset-password", { email, code, password }, ip);
}

function loginRequest(password: string, ip?: string) {
  return jsonRequest(
    "/api/auth/login",
    { email: EMAIL, password, rememberMe: false },
    ip,
  );
}

async function createAccount() {
  const response = await register(
    jsonRequest("/api/auth/register", {
      firstName: "Ada",
      lastName: "Lovelace",
      email: EMAIL,
      password: OLD_PASSWORD,
    }),
  );
  expect(response.status).toBe(201);
}

function activeResetCode(email = EMAIL) {
  const code = createPasswordResetCode(email);
  commitPasswordResetCode(email, code);
  return code;
}

function enableWebhook() {
  process.env.AUTH_PASSWORD_RESET_WEBHOOK_URL = "https://mail.example.test/reset";
  process.env.AUTH_PASSWORD_RESET_WEBHOOK_SECRET = "reset-webhook-secret";
}

function webhookPayload(call: unknown[]) {
  const init = call[1] as RequestInit;
  return {
    init,
    body: JSON.parse(String(init.body)) as {
      type: string;
      email: string;
      name: string;
      code: string;
      resetUrl: string;
      expiresInMinutes: number;
    },
  };
}

describe("password recovery route handlers", () => {
  beforeEach(async () => {
    await resetAuthTestEnvironment(directory);
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    await removeAuthTestDirectory(directory);
  });

  it("rejects malformed forgot-password input", async () => {
    const malformed = await forgotPassword(
      uniqueRequest("/api/auth/forgot-password", {
        method: "POST",
        body: "{",
      }),
    );
    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toEqual({ error: "invalid_request" });

    for (const email of ["", "not-an-email", `${"a".repeat(250)}@example.com`]) {
      const response = await forgotPassword(forgotRequest(email));
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: "invalid_email" });
    }
  });

  it("reports unavailable only when password recovery is globally unconfigured", async () => {
    enableWebhook();
    const noCredentials = await forgotPassword(forgotRequest());
    expect(noCredentials.status).toBe(503);
    await expect(noCredentials.json()).resolves.toEqual({
      error: "password_reset_not_configured",
    });

    await createAccount();
    delete process.env.AUTH_PASSWORD_RESET_WEBHOOK_URL;
    const noWebhook = await forgotPassword(forgotRequest());
    expect(noWebhook.status).toBe(503);
  });

  it("sends an authenticated webhook without exposing the code publicly", async () => {
    await createAccount();
    enableWebhook();
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await forgotPassword(
      forgotRequest("  ADMIN@Example.COM ", "198.51.100.31"),
    );
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ accepted: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    const payload = webhookPayload(fetchMock.mock.calls[0]).body;
    expect(url).toBe("https://mail.example.test/reset");
    expect(init).toMatchObject({ method: "POST" });
    expect(new Headers(init.headers).get("authorization")).toBe(
      "Bearer reset-webhook-secret",
    );
    expect(payload).toMatchObject({
      type: "password_reset",
      email: EMAIL,
      name: "Ada Lovelace",
      expiresInMinutes: 15,
    });
    expect(payload.code).toMatch(/^\d{6}$/);
    expect(payload.resetUrl).toBe(
      "http://localhost/reset-password?email=admin%40example.com",
    );
  });

  it("returns the same public response for known, unknown and delivery-failure emails", async () => {
    await createAccount();
    enableWebhook();
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    const responses = await Promise.all([
      forgotPassword(forgotRequest(EMAIL, "198.51.100.41")),
      forgotPassword(forgotRequest("unknown@example.com", "198.51.100.42")),
    ]);
    responses.push(
      await forgotPassword(forgotRequest(EMAIL, "198.51.100.43")),
    );

    for (const response of responses) {
      expect(response.status).toBe(202);
      expect(response.headers.get("cache-control")).toBe("no-store");
      await expect(response.json()).resolves.toEqual({ accepted: true });
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("revokes a code when its delivery fails", async () => {
    await createAccount();
    enableWebhook();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    expect((await forgotPassword(forgotRequest())).status).toBe(202);
    const code = webhookPayload(fetchMock.mock.calls[0]).body.code;
    expect(verifyAndConsumePasswordResetCode(EMAIL, code)).toBe(false);
  });

  it("keeps the last delivered code when a newer delivery fails", async () => {
    await createAccount();
    enableWebhook();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    await forgotPassword(forgotRequest(EMAIL, "198.51.100.45"));
    const deliveredCode = webhookPayload(fetchMock.mock.calls[0]).body.code;
    await forgotPassword(forgotRequest(EMAIL, "198.51.100.46"));
    expect((await resetPassword(resetRequest(deliveredCode))).status).toBe(200);
  });

  it("a late failure from an older delivery cannot revoke a newer code", async () => {
    await createAccount();
    enableWebhook();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    let releaseFirst!: (response: Response) => void;
    const firstDelivery = new Promise<Response>((resolve) => {
      releaseFirst = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => firstDelivery)
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const olderRequest = forgotPassword(
      forgotRequest(EMAIL, "198.51.100.51"),
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const newerResponse = await forgotPassword(
      forgotRequest(EMAIL, "198.51.100.52"),
    );
    expect(newerResponse.status).toBe(202);
    const newerCode = webhookPayload(fetchMock.mock.calls[1]).body.code;

    releaseFirst(new Response(null, { status: 503 }));
    expect((await olderRequest).status).toBe(202);
    expect((await resetPassword(resetRequest(newerCode))).status).toBe(200);
    await expect(verifyPasswordCredentials(EMAIL, NEW_PASSWORD)).resolves.toBe(true);
  });

  it("keeps an older successful delivery when the newer delivery fails", async () => {
    await createAccount();
    enableWebhook();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    let succeedOlder!: (response: Response) => void;
    let failNewer!: (response: Response) => void;
    const olderDelivery = new Promise<Response>((resolve) => {
      succeedOlder = resolve;
    });
    const newerDelivery = new Promise<Response>((resolve) => {
      failNewer = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => olderDelivery)
      .mockImplementationOnce(() => newerDelivery);
    vi.stubGlobal("fetch", fetchMock);

    const olderRequest = forgotPassword(
      forgotRequest(EMAIL, "198.51.100.58"),
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const olderCode = webhookPayload(fetchMock.mock.calls[0]).body.code;
    const newerRequest = forgotPassword(
      forgotRequest(EMAIL, "198.51.100.59"),
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    succeedOlder(new Response(null, { status: 204 }));
    expect((await olderRequest).status).toBe(202);
    failNewer(new Response(null, { status: 503 }));
    expect((await newerRequest).status).toBe(202);
    expect((await resetPassword(resetRequest(olderCode))).status).toBe(200);
  });

  it("restores only the delivered code after two overlapping delivery failures", async () => {
    await createAccount();
    enableWebhook();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    let failMiddle!: (response: Response) => void;
    let failNewest!: (response: Response) => void;
    const middleDelivery = new Promise<Response>((resolve) => {
      failMiddle = resolve;
    });
    const newestDelivery = new Promise<Response>((resolve) => {
      failNewest = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockImplementationOnce(() => middleDelivery)
      .mockImplementationOnce(() => newestDelivery);
    vi.stubGlobal("fetch", fetchMock);

    await forgotPassword(forgotRequest(EMAIL, "198.51.100.53"));
    const deliveredCode = webhookPayload(fetchMock.mock.calls[0]).body.code;
    const middleRequest = forgotPassword(
      forgotRequest(EMAIL, "198.51.100.54"),
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const newestRequest = forgotPassword(
      forgotRequest(EMAIL, "198.51.100.55"),
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    failMiddle(new Response(null, { status: 503 }));
    expect((await middleRequest).status).toBe(202);
    failNewest(new Response(null, { status: 503 }));
    expect((await newestRequest).status).toBe(202);
    expect((await resetPassword(resetRequest(deliveredCode))).status).toBe(200);
  });

  it("a successful reset invalidates a delivery that was still pending", async () => {
    await createAccount();
    enableWebhook();
    let releasePending!: (response: Response) => void;
    const pendingDelivery = new Promise<Response>((resolve) => {
      releasePending = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockImplementationOnce(() => pendingDelivery);
    vi.stubGlobal("fetch", fetchMock);

    await forgotPassword(forgotRequest(EMAIL, "198.51.100.56"));
    const deliveredCode = webhookPayload(fetchMock.mock.calls[0]).body.code;
    const pendingRequest = forgotPassword(
      forgotRequest(EMAIL, "198.51.100.57"),
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const pendingCode = webhookPayload(fetchMock.mock.calls[1]).body.code;

    expect((await resetPassword(resetRequest(deliveredCode))).status).toBe(200);
    releasePending(new Response(null, { status: 204 }));
    expect((await pendingRequest).status).toBe(202);
    expect((await resetPassword(resetRequest(pendingCode))).status).toBe(400);
  });

  it("a newer request invalidates the previously delivered code", async () => {
    await createAccount();
    enableWebhook();
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    await forgotPassword(forgotRequest(EMAIL, "198.51.100.61"));
    await forgotPassword(forgotRequest(EMAIL, "198.51.100.62"));
    const oldCode = webhookPayload(fetchMock.mock.calls[0]).body.code;
    const newCode = webhookPayload(fetchMock.mock.calls[1]).body.code;
    expect((await resetPassword(resetRequest(oldCode))).status).toBe(400);
    expect((await resetPassword(resetRequest(newCode))).status).toBe(200);
  });

  it("validates reset input and password boundaries before consuming a code", async () => {
    await createAccount();
    const malformed = await resetPassword(
      uniqueRequest("/api/auth/reset-password", { method: "POST", body: "{" }),
    );
    expect(malformed.status).toBe(400);

    for (const body of [null, {}, { email: "bad", code: "123456", password: NEW_PASSWORD }]) {
      const response = await resetPassword(
        jsonRequest("/api/auth/reset-password", body),
      );
      expect(response.status).toBe(400);
    }

    const code = activeResetCode();
    expect((await resetPassword(resetRequest(code, "x".repeat(11)))).status).toBe(400);
    expect((await resetPassword(resetRequest(code, "x".repeat(12)))).status).toBe(200);

    const maxCode = activeResetCode();
    expect((await resetPassword(resetRequest(maxCode, "x".repeat(128)))).status).toBe(200);
    const tooLongCode = activeResetCode();
    expect((await resetPassword(resetRequest(tooLongCode, "x".repeat(129)))).status).toBe(400);
    expect(verifyAndConsumePasswordResetCode(EMAIL, tooLongCode)).toBe(true);
  });

  it("lets exactly one of two simultaneous submissions consume a code", async () => {
    await createAccount();
    const code = activeResetCode();
    const responses = await Promise.all([
      resetPassword(resetRequest(code, NEW_PASSWORD, EMAIL, "198.51.100.71")),
      resetPassword(resetRequest(code, NEW_PASSWORD, EMAIL, "198.51.100.72")),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 400]);
  });

  it("persists the new salted password and clears a proven login lockout", async () => {
    await createAccount();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(
        (await login(loginRequest("Wrong-Password-2026!", `203.0.113.${attempt + 1}`))).status,
      ).toBe(401);
    }
    expect((await login(loginRequest(OLD_PASSWORD, "203.0.113.20"))).status).toBe(429);

    const code = activeResetCode();
    expect((await resetPassword(resetRequest(code))).status).toBe(200);
    await expect(verifyPasswordCredentials(EMAIL, OLD_PASSWORD)).resolves.toBe(false);
    await expect(verifyPasswordCredentials(EMAIL, NEW_PASSWORD)).resolves.toBe(true);
    expect((await login(loginRequest(NEW_PASSWORD, "203.0.113.21"))).status).toBe(200);
  });

  it("enforces request and confirmation rate-limit boundaries with safe headers", async () => {
    await createAccount();
    enableWebhook();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(
        (await forgotPassword(forgotRequest(EMAIL, `192.0.2.${attempt + 1}`))).status,
      ).toBe(202);
    }
    const requestBlocked = await forgotPassword(
      forgotRequest(EMAIL, "192.0.2.10"),
    );
    expect(requestBlocked.status).toBe(429);
    expect(requestBlocked.headers.get("retry-after")).not.toBeNull();
    expect(requestBlocked.headers.get("cache-control")).toBe("no-store");

    for (let attempt = 0; attempt < 30; attempt += 1) {
      expect(
        (
          await resetPassword(
            resetRequest("000000", NEW_PASSWORD, EMAIL, "192.0.2.50"),
          )
        ).status,
      ).toBe(400);
    }
    const confirmationBlocked = await resetPassword(
      resetRequest("000000", NEW_PASSWORD, EMAIL, "192.0.2.50"),
    );
    expect(confirmationBlocked.status).toBe(429);
    await expect(confirmationBlocked.json()).resolves.toMatchObject({
      error: "too_many_reset_attempts",
      retryAfterSeconds: expect.any(Number),
    });
    expect(confirmationBlocked.headers.get("retry-after")).not.toBeNull();
    expect(confirmationBlocked.headers.get("cache-control")).toBe("no-store");
  });
});
