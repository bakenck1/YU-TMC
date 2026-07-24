import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_APP_SETTINGS,
  isAppLanguage,
  isAppSettings,
  type AppSettings,
} from "@/lib/app-settings";
import {
  consumeApiRateLimit,
  rateLimitedResponse,
  rateLimitHeaders,
} from "@/lib/security/rate-limiter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SETTINGS_DIRECTORY = path.join(process.cwd(), ".data");
const SETTINGS_FILE = path.join(SETTINGS_DIRECTORY, "settings.json");

async function readSettings(): Promise<AppSettings> {
  try {
    const content = await readFile(SETTINGS_FILE, "utf8");
    const parsed: unknown = JSON.parse(content);
    return isAppSettings(parsed) ? parsed : DEFAULT_APP_SETTINGS;
  } catch {
    await mkdir(SETTINGS_DIRECTORY, { recursive: true });
    await writeFile(SETTINGS_FILE, JSON.stringify(DEFAULT_APP_SETTINGS, null, 2), "utf8");
    return DEFAULT_APP_SETTINGS;
  }
}

async function saveSettings(settings: AppSettings) {
  await mkdir(SETTINGS_DIRECTORY, { recursive: true });
  await writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf8");
}

export async function GET(request: Request) {
  const apiLimit = consumeApiRateLimit(request);
  if (!apiLimit.allowed) return rateLimitedResponse(apiLimit);

  return Response.json(await readSettings(), {
    headers: rateLimitHeaders(apiLimit),
  });
}

export async function PATCH(request: Request) {
  const apiLimit = consumeApiRateLimit(request);
  if (!apiLimit.allowed) return rateLimitedResponse(apiLimit);

  try {
    const patch = (await request.json()) as Partial<AppSettings>;
    const current = await readSettings();
    const next: AppSettings = { ...current };

    if ("organizationName" in patch) {
      if (typeof patch.organizationName !== "string") {
        return Response.json(
          { error: "invalid_organization_name" },
          { status: 400, headers: rateLimitHeaders(apiLimit) },
        );
      }
      const organizationName = patch.organizationName.trim();
      if (organizationName.length < 2 || organizationName.length > 80) {
        return Response.json(
          { error: "invalid_organization_name" },
          { status: 400, headers: rateLimitHeaders(apiLimit) },
        );
      }
      next.organizationName = organizationName;
    }

    if ("language" in patch) {
      if (!isAppLanguage(patch.language)) {
        return Response.json(
          { error: "invalid_language" },
          { status: 400, headers: rateLimitHeaders(apiLimit) },
        );
      }
      next.language = patch.language;
    }

    for (const key of [
      "emailNotifications",
      "pushNotifications",
      "maintenanceAlerts",
    ] as const) {
      if (key in patch) {
        if (typeof patch[key] !== "boolean") {
          return Response.json(
            { error: "invalid_notification_setting" },
            { status: 400, headers: rateLimitHeaders(apiLimit) },
          );
        }
        next[key] = patch[key];
      }
    }

    await saveSettings(next);
    return Response.json(next, { headers: rateLimitHeaders(apiLimit) });
  } catch {
    return Response.json(
      { error: "settings_save_failed" },
      { status: 500, headers: rateLimitHeaders(apiLimit) },
    );
  }
}
