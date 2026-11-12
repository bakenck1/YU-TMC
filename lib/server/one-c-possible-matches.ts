import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { getDatabasePool } from "@/lib/db/client";
import { ApplicationError } from "@/lib/domain/application-error";
import type { OneCAdminActor } from "@/lib/server/http/one-c-reconciliation-admin-handler";
import { getOneCAnalyticsSnapshot } from "@/lib/server/one-c-analytics-service";
import { classifyOneCAudit } from "@/lib/one-c-analytics";

type Snapshot = Awaited<ReturnType<typeof getOneCAnalyticsSnapshot>>;
export type PossibleBalance = {
  source: "OS" | "MP"; sourceId: string; name: string; number: string | null;
  price: string | number | null; responsible: string | null;
};
export type PossibleCode = { code: string; balances: PossibleBalance[] };
export type PossibleCard = {
  id: string; name: string; inventoryNumber: string; itemVersion: number;
  itemSection: string; reviewHash: string; candidates: PossibleCode[];
};
export type ConfirmPossibleInput = { itemId: string; itemVersion: number; reviewHash: string; code: string };

/** Confirmation selects a nomenclature code. Every source balance remains visible. */
export function getOneCPossibleMatches(snapshot: Snapshot): PossibleCard[] {
  const presence = classifyOneCAudit(snapshot.rows);
  const items = new Map(snapshot.inventory.map(item => [item.id, item]));
  const balancesByCode = new Map<string, PossibleBalance[]>();
  const add = (code: string | null | undefined, balance: PossibleBalance) => {
    if (!code?.trim()) return;
    const balances = balancesByCode.get(code) ?? [];
    balances.push(balance);
    balancesByCode.set(code, balances);
  };
  for (const entry of snapshot.registryAssets ?? snapshot.assets) add(entry.asset.code, {
    source: "OS", sourceId: entry.externalId, name: entry.asset.name, number: entry.asset.inventoryNumber,
    price: entry.asset.quantity === 1 ? entry.asset.initialCost ?? null : null, responsible: entry.asset.responsibleName ?? null,
  });
  for (const entry of snapshot.materialRecords) add(entry.material.code, {
    source: "MP", sourceId: entry.key, name: entry.material.name, number: entry.material.inventoryNumber,
    price: entry.material.unitPrice, responsible: entry.material.responsibleName ?? null,
  });
  return snapshot.rows.filter(row => presence.get(row.itemId)?.category === "possible").map(row => {
    const codes = [...new Set([...row.oneC.map(entry => entry.code), ...row.excel.map(entry => entry.oneCCode)]
      .filter((code): code is string => Boolean(code?.trim())))].sort();
    const candidates = codes.map(code => ({ code, balances: [...(balancesByCode.get(code) ?? [])]
      .sort((a, b) => a.source.localeCompare(b.source) || a.sourceId.localeCompare(b.sourceId)) }));
    const itemSection = items.get(row.itemId)?.itemSection ?? "general";
    const sources = {
      assets: (snapshot.registryAssets ?? snapshot.assets).filter(entry => codes.includes(entry.asset.code ?? "")),
      materials: snapshot.materialRecords.filter(entry => codes.includes(entry.material.code)),
    };
    const reviewHash = createHash("sha256").update(JSON.stringify({ row, candidates, itemSection, sources })).digest("hex");
    return { id: row.itemId, name: row.itemName, inventoryNumber: row.siteNumber,
      itemVersion: row.itemVersion, itemSection, reviewHash, candidates };
  });
}

export async function confirmOneCPossibleMatch(input: ConfirmPossibleInput, actor: OneCAdminActor, pool: Pick<Pool, "connect"> = getDatabasePool()) {
  if (actor.role !== "admin") throw new ApplicationError("forbidden", "forbidden");
  const client = await pool.connect();
  try {
    await client.query("begin isolation level serializable");
    await client.query("set local lock_timeout = '5s'");
    await client.query("set local statement_timeout = '30s'");
    // Imports cannot change a displayed source between its validation and commit.
    await client.query("lock table yu_inventory.one_c_fixed_asset_inbox, yu_inventory.one_c_material_inbox in share mode");
    const actorResult = await client.query("select role,is_active,deleted_at,version from yu_inventory.users where id=$1 for share", [actor.userId]);
    const user = actorResult.rows[0];
    if (!user || user.role !== "admin" || !user.is_active || user.deleted_at != null
      || (actor.sessionVersion !== undefined && user.version !== actor.sessionVersion)) throw new ApplicationError("forbidden", "forbidden");
    const current = await client.query("select id,version,one_c_code,item_section,status,archived_at from yu_inventory.items where id=$1 for update", [input.itemId]);
    const item = current.rows[0];
    if (!item || item.archived_at != null || item.status !== "active" || item.version !== input.itemVersion) throw stale();
    if (item.item_section !== "general") throw new ApplicationError("validation", "one_c_possible_unsupported_section");
    const snapshot = await getOneCAnalyticsSnapshot(pool, client);
    const card = getOneCPossibleMatches(snapshot).find(entry => entry.id === input.itemId);
    if (!card || card.reviewHash !== input.reviewHash || !card.candidates.some(candidate => candidate.code === input.code)) throw stale();
    const updated = await client.query(`update yu_inventory.items set one_c_code=$2,version=version+1,updated_by=$3,updated_at=now()
      where id=$1 and version=$4 returning version`, [input.itemId, input.code, actor.userId, input.itemVersion]);
    if (!updated.rows.length) throw stale();
    await client.query(`insert into yu_inventory.audit_records
      (id,actor_id,actor_role_snapshot,subject_kind,subject_id,subject_revision,action,before_values,after_values,metadata)
      values($1,$2,'admin','item',$3,$4,'item.one_c_code_updated',$5::jsonb,$6::jsonb,$7::jsonb)`,
    [randomUUID(), actor.userId, input.itemId, updated.rows[0].version,
      JSON.stringify({ oneCCode: item.one_c_code, version: input.itemVersion }),
      JSON.stringify({ oneCCode: input.code, version: updated.rows[0].version }),
      JSON.stringify({ source: "one_c_possible_confirmation", reviewHash: input.reviewHash,
        selectedCode: input.code, candidates: card.candidates.find(candidate => candidate.code === input.code) })]);
    await client.query("commit");
    return { itemId: input.itemId, oneCCode: input.code, version: updated.rows[0].version };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    if (error && typeof error === "object" && "code" in error && ["40001", "40P01", "55P03", "57014"].includes(String(error.code))) throw stale();
    throw error;
  } finally { client.release(); }
}

function stale() { return new ApplicationError("conflict", "one_c_possible_stale"); }
