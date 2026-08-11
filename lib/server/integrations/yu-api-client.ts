import "server-only";

import { z } from "zod";

import { ApplicationError } from "@/lib/domain/application-error";

const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_RESULTS = 20;

export interface YuApiPersonnelEntry {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
}

export interface YuApiAuthenticatedIdentity {
  email: string;
}

interface YuApiConfiguration {
  baseUrl: URL;
  token: string;
  timeoutMs: number;
}

type FetchImplementation = (
  input: URL | RequestInfo,
  init?: RequestInit,
) => Promise<Response>;

type Environment = Readonly<Record<string, string | undefined>>;

const nullableText = z.string().nullable().optional();
const personnelSchema = z
  .object({
    id: z.union([z.string(), z.number()]),
    full_name: nullableText,
    display_name: nullableText,
    first_name: nullableText,
    last_name: nullableText,
    middle_name: nullableText,
    mobile_phone: nullableText,
    work_phone: nullableText,
    is_active: z.boolean().optional(),
    user: z
      .object({
        email: nullableText,
        is_active: z.boolean().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();

const personnelPageSchema = z
  .object({
    results: z.array(personnelSchema),
  })
  .passthrough();

const authenticatedUserSchema = z
  .object({
    email: z.string(),
    is_active: z.boolean().optional(),
    token: z.string().min(1),
  })
  .passthrough();

export class YuApiClient {
  constructor(
    private readonly configuration: YuApiConfiguration,
    private readonly fetchImplementation: FetchImplementation = fetch,
  ) {}

  async checkConnection(): Promise<void> {
    const url = new URL("api/v2/personnels/", this.configuration.baseUrl);
    url.searchParams.set("size", "1");
    url.searchParams.set("is_active", "true");
    await this.readPersonnelPage(url);
  }

  async searchPersonnel(
    queryInput: string,
    limitInput = 10,
  ): Promise<YuApiPersonnelEntry[]> {
    const query = queryInput.trim();
    if (
      Array.from(query).length < 2 ||
      Array.from(query).length > 100 ||
      /^\d{12}$/.test(query.replace(/[\s-]/g, ""))
    ) {
      throw new ApplicationError("validation", "invalid_yu_api_query");
    }
    const limit = Math.min(Math.max(Math.trunc(limitInput), 1), MAX_RESULTS);
    const url = new URL("api/v2/personnels/", this.configuration.baseUrl);
    url.searchParams.set("search", query);
    url.searchParams.set("size", String(limit));
    url.searchParams.set("is_active", "true");

    const page = await this.readPersonnelPage(url);
    return page.results
      .filter(
        (person) =>
          person.is_active !== false && person.user?.is_active !== false,
      )
      .map(toDirectoryEntry)
      .filter((person): person is YuApiPersonnelEntry => person !== null)
      .slice(0, limit);
  }

  async authenticateLegacyCredentials(
    identifierInput: string,
    password: string,
  ): Promise<YuApiAuthenticatedIdentity | null> {
    const identifier = identifierInput.trim();
    if (
      !identifier ||
      Array.from(identifier).length > 254 ||
      /\s/.test(identifier) ||
      !password ||
      password.length > 1_024
    ) {
      return null;
    }

    const url = new URL("api/users/login/", this.configuration.baseUrl);
    let response: Response;
    try {
      response = await this.fetchImplementation(url, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ username: identifier, password }),
        cache: "no-store",
        signal: AbortSignal.timeout(this.configuration.timeoutMs),
      });
    } catch (cause) {
      throw new ApplicationError("unavailable", "yu_api_unavailable", {
        cause,
      });
    }

    if ([400, 401, 403].includes(response.status)) return null;
    if (!response.ok) {
      throw new ApplicationError("unavailable", "yu_api_unavailable", {
        safeDetails: { upstreamStatus: String(response.status) },
      });
    }

    const text = await response.text();
    if (text.length > MAX_RESPONSE_BYTES) {
      throw new ApplicationError("unavailable", "yu_api_response_too_large");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (cause) {
      throw new ApplicationError("unavailable", "yu_api_invalid_response", {
        cause,
      });
    }
    const authenticatedUser = authenticatedUserSchema.safeParse(parsed);
    if (!authenticatedUser.success) {
      throw new ApplicationError("unavailable", "yu_api_invalid_response");
    }
    const email = authenticatedUser.data.email.trim().toLowerCase();
    if (
      authenticatedUser.data.is_active === false ||
      email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
      return null;
    }

    // The legacy API token is intentionally discarded. YU-TMC creates and owns
    // its own session after matching the verified email to a local account.
    return { email };
  }

  private async readPersonnelPage(
    url: URL,
  ): Promise<z.infer<typeof personnelPageSchema>> {
    let response: Response;
    try {
      response = await this.fetchImplementation(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Token ${this.configuration.token}`,
        },
        cache: "no-store",
        signal: AbortSignal.timeout(this.configuration.timeoutMs),
      });
    } catch (cause) {
      throw new ApplicationError("unavailable", "yu_api_unavailable", {
        cause,
      });
    }

    if (response.status === 401 || response.status === 403) {
      throw new ApplicationError("unavailable", "yu_api_authentication_failed");
    }
    if (!response.ok) {
      throw new ApplicationError("unavailable", "yu_api_unavailable", {
        safeDetails: { upstreamStatus: String(response.status) },
      });
    }

    const text = await response.text();
    if (text.length > MAX_RESPONSE_BYTES) {
      throw new ApplicationError("unavailable", "yu_api_response_too_large");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (cause) {
      throw new ApplicationError("unavailable", "yu_api_invalid_response", {
        cause,
      });
    }
    const page = personnelPageSchema.safeParse(parsed);
    if (!page.success) {
      throw new ApplicationError("unavailable", "yu_api_invalid_response");
    }

    return page.data;
  }
}

export function createYuApiClient(
  environment: Environment = process.env,
  fetchImplementation: FetchImplementation = fetch,
): YuApiClient {
  return new YuApiClient(readYuApiConfiguration(environment), fetchImplementation);
}

function readYuApiConfiguration(
  environment: Environment,
): YuApiConfiguration {
  const rawBaseUrl = environment.YU_API_BASE_URL?.trim();
  const token = environment.YU_API_TOKEN?.trim();
  if (!rawBaseUrl || !token) {
    throw new ApplicationError("unavailable", "yu_api_not_configured");
  }

  let baseUrl: URL;
  try {
    baseUrl = new URL(rawBaseUrl.endsWith("/") ? rawBaseUrl : `${rawBaseUrl}/`);
  } catch (cause) {
    throw new ApplicationError("unavailable", "yu_api_invalid_configuration", {
      cause,
    });
  }
  if (
    !["http:", "https:"].includes(baseUrl.protocol) ||
    baseUrl.username !== "" ||
    baseUrl.password !== ""
  ) {
    throw new ApplicationError("unavailable", "yu_api_invalid_configuration");
  }

  const parsedTimeout = Number(environment.YU_API_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(parsedTimeout)
    ? Math.min(Math.max(Math.trunc(parsedTimeout), 1_000), 15_000)
    : DEFAULT_TIMEOUT_MS;

  return { baseUrl, token, timeoutMs };
}

function toDirectoryEntry(
  person: z.infer<typeof personnelSchema>,
): YuApiPersonnelEntry | null {
  const email = person.user?.email?.trim().toLowerCase() ?? "";
  if (!email || !email.includes("@")) return null;

  const composedName = [person.last_name, person.first_name, person.middle_name]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ");
  const fullName =
    person.full_name?.trim() || person.display_name?.trim() || composedName;
  if (!fullName) return null;

  return {
    id: String(person.id),
    fullName,
    email,
    phone:
      person.mobile_phone?.trim() || person.work_phone?.trim() || null,
  };
}
