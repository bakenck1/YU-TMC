import "server-only";

const YESSENOV_PERSONNELS_ENDPOINT =
  "https://api.yu.edu.kz/api/v2/personnels/";
const MAX_DIRECTORY_USERS = 50_000;
const MAX_DIRECTORY_PAGES = 1_000;
const DIRECTORY_PAGE_CONCURRENCY = 4;
const DIRECTORY_REQUEST_TIMEOUT_MS = 20_000;
const IIN_PATTERN = /^[0-9]{12}$/;

export interface YessenovOrgUnit {
  id: number;
  nameRu: string | null;
  nameKk: string | null;
  nameEn: string | null;
}

export interface YessenovPosition {
  id: number;
  name: string;
}

export interface YessenovDirectoryEmployee {
  id: number;
  personnelId: number;
  iin: string;
  username: string;
  firstName: string;
  lastName: string;
  middleName: string | null;
  fullName: string;
  displayName: string;
  email: string;
  phone: string;
  image: string | null;
  isActive: boolean;
  isSuperuser: boolean;
  roles: string[];
  employedAt: string | null;
  orgUnit: YessenovOrgUnit | null;
  position: YessenovPosition | null;
}

export interface YessenovDirectoryClient {
  listEmployees(): Promise<YessenovDirectoryEmployee[]>;
  findEmployee(iin: string): Promise<YessenovDirectoryEmployee | null>;
}

type YessenovDirectoryEnvironment = {
  [key: string]: string | undefined;
  YESSENOV_DIRECTORY_API_TOKEN?: string;
};

export class YessenovDirectoryError extends Error {
  constructor(
    readonly reason: "not_configured" | "unavailable" | "invalid_response",
    message: string,
  ) {
    super(message);
    this.name = "YessenovDirectoryError";
  }
}

export function createYessenovDirectoryClient(
  fetcher: typeof fetch = fetch,
  environment: YessenovDirectoryEnvironment = process.env,
): YessenovDirectoryClient {
  return {
    async listEmployees() {
      const url = new URL(YESSENOV_PERSONNELS_ENDPOINT);
      url.searchParams.set("size", "100");
      return fetchDirectoryEmployees(
        url,
        configuredAccessToken(environment),
        fetcher,
      );
    },
    async findEmployee(iin) {
      if (!IIN_PATTERN.test(iin)) return null;
      const url = new URL(YESSENOV_PERSONNELS_ENDPOINT);
      url.searchParams.set("search", iin);
      url.searchParams.set("size", "100");
      const employees = await fetchDirectoryEmployees(
        url,
        configuredAccessToken(environment),
        fetcher,
      );
      return employees.find((employee) => employee.iin === iin) ?? null;
    },
  };
}

function configuredAccessToken(environment: YessenovDirectoryEnvironment) {
  const token = environment.YESSENOV_DIRECTORY_API_TOKEN?.trim();
  if (!token) {
    throw new YessenovDirectoryError(
      "not_configured",
      "Yessenov directory API token is not configured",
    );
  }
  return token;
}

async function fetchDirectoryEmployees(
  initialUrl: URL,
  accessToken: string,
  fetcher: typeof fetch,
) {
  const employees: YessenovDirectoryEmployee[] = [];
  const seenIins = new Set<string>();
  const addPage = (page: ReturnType<typeof parseDirectoryPage>) => {
    for (const value of page.results) {
      const employee = parseDirectoryEmployee(value);
      if (!employee || seenIins.has(employee.iin)) continue;
      seenIins.add(employee.iin);
      employees.push(employee);
      if (employees.length > MAX_DIRECTORY_USERS) {
        throw new YessenovDirectoryError(
          "invalid_response",
          "Yessenov directory response is too large",
        );
      }
    }
  };

  assertSafeDirectoryUrl(initialUrl);
  const firstPage = await fetchDirectoryPage(
    initialUrl,
    accessToken,
    fetcher,
  );
  addPage(firstPage);
  if (!firstPage.next) return employees;

  const secondPageUrl = safeNextUrl(firstPage.next);
  const plannedUrls = planNumberedPages(firstPage, secondPageUrl);
  if (plannedUrls) {
    for (
      let offset = 0;
      offset < plannedUrls.length;
      offset += DIRECTORY_PAGE_CONCURRENCY
    ) {
      const pages = await Promise.all(
        plannedUrls
          .slice(offset, offset + DIRECTORY_PAGE_CONCURRENCY)
          .map((url) => fetchDirectoryPage(url, accessToken, fetcher)),
      );
      pages.forEach(addPage);
    }
    return employees;
  }

  const visitedPages = new Set([initialUrl.href]);
  let nextUrl: URL | null = secondPageUrl;
  while (nextUrl) {
    if (
      visitedPages.has(nextUrl.href) ||
      visitedPages.size >= MAX_DIRECTORY_PAGES
    ) {
      throw new YessenovDirectoryError(
        "invalid_response",
        "Yessenov directory pagination is invalid",
      );
    }
    visitedPages.add(nextUrl.href);
    const page = await fetchDirectoryPage(nextUrl, accessToken, fetcher);
    addPage(page);
    nextUrl = page.next ? safeNextUrl(page.next) : null;
  }

  return employees;
}

async function fetchDirectoryPage(
  url: URL,
  accessToken: string,
  fetcher: typeof fetch,
) {
  assertSafeDirectoryUrl(url);
  let response: Response;
  try {
    response = await fetcher(url, {
      headers: {
        Accept: "application/json",
        Authorization: `Token ${accessToken}`,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(DIRECTORY_REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new YessenovDirectoryError(
      "unavailable",
      "Yessenov directory API is unavailable",
    );
  }

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new YessenovDirectoryError(
      "unavailable",
      `Yessenov directory API returned ${response.status}`,
    );
  }
  return parseDirectoryPage(body);
}

function planNumberedPages(
  firstPage: ReturnType<typeof parseDirectoryPage>,
  secondPageUrl: URL,
): URL[] | null {
  const secondPageNumber = Number(secondPageUrl.searchParams.get("page"));
  if (
    firstPage.count === null ||
    firstPage.size === null ||
    firstPage.size < 1 ||
    !Number.isSafeInteger(secondPageNumber) ||
    secondPageNumber < 2
  ) {
    return null;
  }
  const totalPages = Math.ceil(firstPage.count / firstPage.size);
  if (totalPages > MAX_DIRECTORY_PAGES) {
    throw new YessenovDirectoryError(
      "invalid_response",
      "Yessenov directory response is too large",
    );
  }
  const urls: URL[] = [];
  for (let page = secondPageNumber; page <= totalPages; page += 1) {
    const url = new URL(secondPageUrl);
    url.searchParams.set("page", String(page));
    assertSafeDirectoryUrl(url);
    urls.push(url);
  }
  return urls;
}

function parseDirectoryPage(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.results)) {
    throw new YessenovDirectoryError(
      "invalid_response",
      "Yessenov directory response is invalid",
    );
  }
  if (value.next !== null && typeof value.next !== "string") {
    throw new YessenovDirectoryError(
      "invalid_response",
      "Yessenov directory pagination is invalid",
    );
  }
  return {
    results: value.results,
    next: value.next as string | null,
    count: integer(value.count),
    size: integer(value.size),
  };
}

function parseDirectoryEmployee(
  value: unknown,
): YessenovDirectoryEmployee | null {
  if (!isRecord(value)) return null;
  const legacyPersonnel = isRecord(value.personnel) ? value.personnel : null;
  const isLegacyUserPayload = legacyPersonnel !== null;
  const personnel: Record<string, unknown> = legacyPersonnel ?? value;
  const account = isRecord(personnel.user)
    ? personnel.user
    : isLegacyUserPayload
      ? value
      : personnel;
  const iin = text(personnel.identify_code);
  if (
    !IIN_PATTERN.test(iin) ||
    personnel.is_active !== true ||
    ("is_active" in account && account.is_active !== true)
  ) {
    return null;
  }

  const personnelId = integer(personnel.id);
  const id =
    integer(account.id) ?? integer(personnel.user) ?? personnelId;
  const email =
    normalizedEmail(account.email) ||
    normalizedEmail(personnel.email) ||
    normalizedEmail(personnel.work_email);
  const username =
    text(account.username) ||
    text(personnel.username) ||
    email.split("@")[0] ||
    String(id ?? "");
  const firstName = text(personnel.first_name) || text(account.first_name);
  const lastName = text(personnel.last_name) || text(account.last_name);
  const middleName = nullableText(personnel.middle_name);
  const constructedName = [lastName, firstName, middleName]
    .filter(Boolean)
    .join(" ");
  const fullName = text(personnel.full_name) || constructedName;
  const displayName = text(personnel.display_name) || fullName;
  if (
    id === null ||
    personnelId === null ||
    !username ||
    !email ||
    !firstName ||
    !lastName ||
    !fullName
  ) {
    return null;
  }

  const mainPosition = isRecord(personnel.main_position)
    ? personnel.main_position
    : null;
  return {
    id,
    personnelId,
    iin,
    username,
    firstName,
    lastName,
    middleName,
    fullName,
    displayName,
    email,
    phone:
      nullableText(personnel.mobile_phone) ??
      nullableText(personnel.work_phone) ??
      nullableText(account.phone_number) ??
      nullableText(personnel.phone_number) ??
      "",
    image: safeHttpsUrl(account.image) ?? safeHttpsUrl(personnel.image),
    isActive: true,
    isSuperuser: account.is_superuser === true,
    roles: uniqueStrings([
      ...roleNames(account.role),
      ...roleNames(account.roles),
      ...roleNames(personnel.role),
      ...roleNames(personnel.roles),
    ]),
    employedAt: isoDate(personnel.employed_at),
    orgUnit: parseOrgUnit(mainPosition?.orgunit),
    position: parsePosition(mainPosition?.position),
  };
}

function parseOrgUnit(value: unknown): YessenovOrgUnit | null {
  if (!isRecord(value)) return null;
  const id = integer(value.id);
  if (id === null) return null;
  return {
    id,
    nameRu: nullableText(value.name_ru),
    nameKk: nullableText(value.name_kk),
    nameEn: nullableText(value.name_en),
  };
}

function parsePosition(value: unknown): YessenovPosition | null {
  if (!isRecord(value)) return null;
  const id = integer(value.id);
  const name = text(value.name);
  return id === null || !name ? null : { id, name };
}

function safeNextUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value, YESSENOV_PERSONNELS_ENDPOINT);
  } catch {
    throw new YessenovDirectoryError(
      "invalid_response",
      "Yessenov directory pagination is invalid",
    );
  }
  assertSafeDirectoryUrl(url);
  return url;
}

function assertSafeDirectoryUrl(url: URL) {
  const expected = new URL(YESSENOV_PERSONNELS_ENDPOINT);
  if (
    url.protocol !== expected.protocol ||
    url.host !== expected.host ||
    url.pathname !== expected.pathname ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new YessenovDirectoryError(
      "invalid_response",
      "Yessenov directory pagination URL is not allowed",
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown) {
  return typeof value === "string"
    ? value.trim().replace(/\s+/gu, " ").slice(0, 255)
    : "";
}

function nullableText(value: unknown) {
  return text(value) || null;
}

function normalizedEmail(value: unknown) {
  const email = text(value).toLowerCase();
  return /^[^\s@]+@[^\s@]+$/.test(email) ? email : "";
}

function integer(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function roleNames(value: unknown): string[] {
  if (!Array.isArray(value)) return text(value) ? [text(value)] : [];
  return value.flatMap((role) => {
    if (!isRecord(role)) return text(role) ? [text(role)] : [];
    const name = text(role.name) || text(role.code) || text(role.slug);
    return name ? [name] : [];
  });
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values));
}

function isoDate(value: unknown) {
  const date = text(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

function safeHttpsUrl(value: unknown) {
  const raw = text(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
