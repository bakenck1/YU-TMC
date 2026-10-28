import type { UserRole } from "@/lib/contracts/users";
import type { InventoryAuditEnrichmentPlan, InventoryAuditEnrichmentRow } from "@/lib/inventory-audit-enrichment";
import type { AuditMatch } from "@/lib/inventory-source-audit";
import { isInventoryResponsibleRole } from "@/lib/inventory-responsible-user";

export const ONE_C_ALLOWED_RESPONSIBLES = ["Бауыржан Анесович", "Нурмаганбет Ермек Талантович"] as const;
export type EnrichmentResponsibleUser = { id: string; fullName: string; role: UserRole; active: boolean; deleted: boolean };
export type EnrichmentResponsibilityState = { itemId: string; userId: string | null; name: string | null; pendingTransfer: boolean; unavailable: boolean };
const normalized = (value: string) => value.normalize("NFKC").toLocaleLowerCase("ru-RU").replaceAll("ё", "е").replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(/\s+/u).sort().join(" ");
// Explicit source/site spellings of the two approved people. No first-name-only matching.
const aliases = new Map([
  [normalized("Тынымбаев Бауыржан Анесович"), ONE_C_ALLOWED_RESPONSIBLES[0]],
  [normalized("Бауыржан Тынымбаев"), ONE_C_ALLOWED_RESPONSIBLES[0]],
  [normalized("Нұрмағанбет Ермек Талантұлы"), ONE_C_ALLOWED_RESPONSIBLES[1]],
  [normalized("Нурмаганбет Ермек Талантулы"), ONE_C_ALLOWED_RESPONSIBLES[1]],
]);
function allowedKey(value: string) {
  const alias = aliases.get(normalized(value));
  if (alias) return alias;
  const tokens = new Set(normalized(value).split(" "));
  const matches = ONE_C_ALLOWED_RESPONSIBLES.filter(name => normalized(name).split(" ").every(token => tokens.has(token)));
  return matches.length === 1 ? matches[0] : null;
}

/** Only the two explicitly allowed people may be proposed. No fuzzy name or code guessing. */
export function addOneCResponsibilityProposals(plan: InventoryAuditEnrichmentPlan, evidence: AuditMatch[], osNames: Map<string, string | null>, users: EnrichmentResponsibleUser[], states: EnrichmentResponsibilityState[]) {
  const matches = new Map(evidence.map(row => [row.itemId, row]));
  const byItem = new Map(states.map(state => [state.itemId, state]));
  for (const row of plan.rows) {
    const state = byItem.get(row.itemId);
    const proposal: NonNullable<InventoryAuditEnrichmentRow["responsibility"]> = {
      currentUserId: state?.userId ?? null, currentName: state?.name ?? null,
      nextUserId: state?.userId ?? null, nextName: state?.name ?? null, changed: false, status: "unconfirmed",
    };
    row.responsibility = proposal;
    const match = matches.get(row.itemId);
    // Candidate owners remain searchable even when contradictory identifiers
    // prevent assigning them or changing any card field.
    row.searchText = [row.searchText, ...(match?.oneC ?? []).map(entry => osNames.get(entry.externalId)),
      ...(match?.excel ?? []).map(entry => entry.responsibleName)].filter(Boolean).join("\n");
    if (!row.eligible || row.identityMethod === "material_code" || row.identityMethod === "asset_code" || row.identityMethod === "name_owner") continue;
    const claims = row.nameSource === "1c" ? (match?.oneC ?? []).map(entry => osNames.get(entry.externalId) ?? "")
      : (match?.excel ?? []).map(entry => entry.responsibleName ?? "");
    // Empty or differing MOLs across balance rows cannot authorize moving the whole card.
    const names = [...new Set(claims.map(name => normalized(aliases.get(normalized(name)) ?? name)))];
    if (names.length !== 1 || !names[0]) { proposal.status = "ambiguous"; continue; }
    const sourceName = claims[0];
    proposal.sourceName = sourceName;
    const key = allowedKey(sourceName);
    if (!key) { proposal.status = "not_allowed"; continue; }
    const candidates = users.filter(user => allowedKey(user.fullName) === key && user.active && !user.deleted && isInventoryResponsibleRole(user.role));
    // Even an exact full-name candidate must not hide another active namesake for an abbreviated alias.
    if (candidates.length !== 1) { proposal.status = candidates.length ? "user_ambiguous" : "user_missing"; continue; }
    const target = candidates[0];
    if (normalized(sourceName) !== normalized(target.fullName) && normalized(sourceName) !== normalized(key)
      && normalized(target.fullName) !== normalized(key)
      && !(aliases.get(normalized(sourceName)) === key && aliases.get(normalized(target.fullName)) === key)) {
      proposal.status = "user_missing"; continue;
    }
    if (state?.userId === target.id) { proposal.status = "unchanged"; continue; }
    if (state?.pendingTransfer) { proposal.status = "pending_transfer"; continue; }
    if (!state || state.unavailable) { proposal.status = "unavailable"; continue; }
    proposal.nextUserId = target.id;
    proposal.nextName = target.fullName;
    proposal.changed = true;
    proposal.status = "ready";
    if (!row.changed) { plan.counts.unchanged--; plan.counts.ready++; }
    row.changed = true;
    row.reason = "confirmed";
  }
}
