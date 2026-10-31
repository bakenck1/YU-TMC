import type { UserRole } from "@/lib/contracts/users";
import type { InventoryAuditEnrichmentPlan, InventoryAuditEnrichmentRow } from "@/lib/inventory-audit-enrichment";
import type { AuditMatch } from "@/lib/inventory-source-audit";
import { isInventoryResponsibleRole } from "@/lib/inventory-responsible-user";
import { classifyOneCAudit } from "@/lib/one-c-analytics";

export type EnrichmentResponsibleUser = { id: string; fullName: string; role: UserRole; active: boolean; deleted: boolean };
export type EnrichmentResponsibilityState = { itemId: string; userId: string | null; name: string | null; pendingTransfer: boolean; unavailable: boolean };
// 1C may append the accounting role on a separate line. It is not part of a person's name.
// Strip only a separate trailing marker; never remove arbitrary words or match partial names.
const normalized = (value: string) => value.normalize("NFKC").trim()
  .replace(/(?:[\s,;]+мол|\s*\(\s*мол\s*\))$/iu, "")
  .toLocaleLowerCase("ru-RU").replaceAll("ё", "е").replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(/\s+/u).sort().join(" ");
// Only established, explicit full-name spellings are interchangeable. Never match a subset of somebody's name.
const aliases = new Map([
  [normalized("Бауыржан Анесович"), normalized("Тынымбаев Бауыржан Анесович")],
  [normalized("Бауыржан Тынымбаев"), normalized("Тынымбаев Бауыржан Анесович")],
  [normalized("Нұрмағанбет Ермек Талантұлы"), normalized("Нурмаганбет Ермек Талантович")],
  [normalized("Нурмаганбет Ермек Талантулы"), normalized("Нурмаганбет Ермек Талантович")],
]);
const personKey = (value: string) => aliases.get(normalized(value)) ?? normalized(value);

/** Fill only vacant assignments from confirmed full identifiers or saved 1C codes. */
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
    row.searchText = [row.searchText, ...(match?.oneC ?? []).map(entry => osNames.get(entry.externalId)),
      ...(match?.excel ?? []).map(entry => entry.responsibleName)].filter(Boolean).join("\n");
    // An assigned card is never transferred by integration, regardless of source, account state or spelling.
    if (state?.userId) { proposal.status = "unchanged"; continue; }
    if (!state || state.unavailable) { proposal.status = "unavailable"; continue; }
    if (state.pendingTransfer) { proposal.status = "pending_transfer"; continue; }
    // A source may safely identify the owner even when its name cannot be applied
    // (too long, shared monitor/system number, or several unanimous source copies).
    // Missing, changed and conflicting identities still cannot authorize an assignment.
    const responsibilityOnly = !row.eligible && !row.changed
      && ["source_ambiguous", "source_reused", "name_invalid", "shared_number_conflict"].includes(row.reason);
    if ((!row.eligible && !responsibilityOnly) || !match || row.identityMethod === "name_owner") continue;
    // Revalidate each source independently. Name/owner fallback alone cannot assign an unowned card.
    const confirmed = (oneC: AuditMatch["oneC"], excel: AuditMatch["excel"]) => {
      const withoutNameOwner = { ...match, oneC: oneC.map(entry => ({ ...entry, matchedBy: entry.matchedBy.filter(method => method !== "name_owner") })),
        excel: excel.map(entry => ({ ...entry, matchedBy: entry.matchedBy?.filter(method => method !== "name_owner") })) };
      const presence = classifyOneCAudit([withoutNameOwner]).get(row.itemId);
      return Boolean(presence?.fixedAssets || presence?.materials);
    };
    const claims = [
      ...match.oneC.filter(entry => confirmed([entry], [])).map(entry => osNames.get(entry.externalId) ?? entry.responsibleName ?? ""),
      ...match.excel.filter(entry => entry.sourceKind === "materials_api" && Number(entry.endingBalance) > 0 && confirmed([], [entry])).map(entry => entry.responsibleName ?? ""),
    ];
    const names = [...new Set(claims.map(personKey))];
    if (names.length !== 1 || !names[0]) { proposal.status = claims.length ? "ambiguous" : "unconfirmed"; continue; }
    proposal.sourceName = claims[0];
    // A first name alone is never an account identity.
    if (names[0].split(" ").length < 2) { proposal.status = "user_missing"; continue; }
    const candidates = users.filter(user => personKey(user.fullName) === names[0] && user.active && !user.deleted && isInventoryResponsibleRole(user.role));
    if (candidates.length !== 1) { proposal.status = candidates.length ? "user_ambiguous" : "user_missing"; continue; }
    const target = candidates[0];
    proposal.nextUserId = target.id;
    proposal.nextName = target.fullName;
    proposal.changed = true;
    proposal.status = "ready";
    if (responsibilityOnly) {
      row.eligible = true;
      row.nextName = row.currentName;
      row.nextCode = row.currentCode;
      plan.counts.skipped--;
      plan.counts.ready++;
    } else if (!row.changed) { plan.counts.unchanged--; plan.counts.ready++; }
    row.changed = true;
    row.reason = "confirmed";
  }
}
