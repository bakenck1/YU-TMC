const PERSONNEL_LIMIT = 50_000;
const EMAIL_PATTERN = /^[^\s@]+@yu\.edu\.kz$/i;
const IIN_PATTERN = /^[0-9]{12}$/;

export interface PersonnelImportCandidate {
  email: string;
  fullName: string;
  iin: string | null;
}

export interface PersonnelImportSummary {
  total: number;
  inactive: number;
  rejectedBySource: number;
  invalidEmail: number;
  invalidName: number;
  duplicateEmailRows: number;
  eligible: number;
  withUniqueIin: number;
  missingOrInvalidIin: number;
  duplicateIinRows: number;
}

export interface PersonnelImportPlan {
  candidates: PersonnelImportCandidate[];
  summary: PersonnelImportSummary;
}

type PersonnelRow = Record<string, unknown>;

export function buildPersonnelImportPlan(value: unknown): PersonnelImportPlan {
  if (!Array.isArray(value) || value.length > PERSONNEL_LIMIT) {
    throw new Error("Personnel source must be an array of at most 50000 rows.");
  }

  const summary: PersonnelImportSummary = {
    total: value.length,
    inactive: 0,
    rejectedBySource: 0,
    invalidEmail: 0,
    invalidName: 0,
    duplicateEmailRows: 0,
    eligible: 0,
    withUniqueIin: 0,
    missingOrInvalidIin: 0,
    duplicateIinRows: 0,
  };
  const activeRows: Array<{
    email: string;
    fullName: string;
    iin: string | null;
  }> = [];
  const activeIinCounts = new Map<string, number>();

  for (const valueRow of value) {
    const row = isRecord(valueRow) ? valueRow : {};
    if (stringValue(row.is_active) !== "1") {
      summary.inactive += 1;
      continue;
    }
    const sourceStatus = stringValue(row.sync_status).toLowerCase();
    if (sourceStatus === "sync_abort") {
      summary.rejectedBySource += 1;
      continue;
    }

    const rawIin = stringValue(row.identify_code);
    if (IIN_PATTERN.test(rawIin)) {
      activeIinCounts.set(rawIin, (activeIinCounts.get(rawIin) ?? 0) + 1);
    }
    const email = normalizedEmail(row.email) || normalizedEmail(row.gsuite_email);
    if (!email) {
      summary.invalidEmail += 1;
      continue;
    }
    const fullName = normalizedName(row);
    if (!fullName) {
      summary.invalidName += 1;
      continue;
    }
    activeRows.push({
      email,
      fullName,
      iin: IIN_PATTERN.test(rawIin) ? rawIin : null,
    });
  }

  const emailCounts = new Map<string, number>();
  for (const row of activeRows) {
    emailCounts.set(row.email, (emailCounts.get(row.email) ?? 0) + 1);
  }

  const candidates: PersonnelImportCandidate[] = [];
  for (const row of activeRows) {
    if ((emailCounts.get(row.email) ?? 0) > 1) {
      summary.duplicateEmailRows += 1;
      continue;
    }
    let iin = row.iin;
    if (!iin) {
      summary.missingOrInvalidIin += 1;
    } else if ((activeIinCounts.get(iin) ?? 0) > 1) {
      summary.duplicateIinRows += 1;
      iin = null;
    } else {
      summary.withUniqueIin += 1;
    }
    candidates.push({ email: row.email, fullName: row.fullName, iin });
  }
  summary.eligible = candidates.length;
  return { candidates, summary };
}

function normalizedEmail(value: unknown) {
  const email = stringValue(value).toLowerCase();
  return email.length <= 254 && EMAIL_PATTERN.test(email) ? email : "";
}

function normalizedName(row: PersonnelRow) {
  const name = [row.last_name, row.first_name, row.middle_name]
    .map(stringValue)
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/gu, " ");
  return name.length >= 2 && name.length <= 120 ? name : "";
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is PersonnelRow {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
