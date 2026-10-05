import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { getDatabasePool } from "@/lib/db/client";
import { ApplicationError } from "@/lib/domain/application-error";
import type { OneCFixedAsset } from "@/lib/contracts/one-c-fixed-assets";
import { buildInventoryAuditEnrichmentPlan, type InventoryAuditEnrichmentItem } from "@/lib/inventory-audit-enrichment";
import { INVENTORY_SOURCE_AUDIT_ALGORITHM_VERSION } from "@/lib/inventory-source-audit";
import { exportInventorySourceAudit } from "@/lib/server/inventory-source-audit-service";
import type { OneCAdminActor } from "@/lib/server/http/one-c-reconciliation-admin-handler";

type ApplyInput = { runId: string; planHash: string };
type ApplyResult = { updated: number; unchanged: number; skipped: number; planHash: string };

export class InventoryAuditEnrichmentService {
  constructor(private readonly pool: Pick<Pool, "connect"> = getDatabasePool()) {}

  preview(batchId: string, actor: OneCAdminActor) {
    return this.transaction(actor, false, (client) => this.plan(client, batchId));
  }

  apply(batchId: string, input: ApplyInput, actor: OneCAdminActor): Promise<ApplyResult> {
    return this.transaction(actor, true, async (client) => {
      // A lost response can be recovered by replaying this exact reviewed plan.
      // The audit record commits atomically with the card changes.
      const previous = await client.query(`select metadata->'result' as result from "yu_inventory"."audit_records"
        where actor_id=$1 and action='item.audit_enrichment' and metadata->>'batchId'=$2
          and metadata->>'planHash'=$3 and metadata->>'runId'=$4 limit 1`, [actor.userId, batchId, input.planHash, input.runId]);
      if (previous.rows[0]) return previous.rows[0].result as ApplyResult;
      const plan = await this.plan(client, batchId, true);
      if (plan.runId !== input.runId || plan.planHash !== input.planHash) throw stale();
      const result: ApplyResult = { updated: plan.counts.ready, unchanged: plan.counts.unchanged, skipped: plan.counts.skipped, planHash: plan.planHash };
      for (const row of plan.rows.filter((entry) => entry.eligible && entry.changed)) {
        const updated = await client.query(`update "yu_inventory"."items" set name=$3,one_c_code=$4,
          version=version+1,updated_at=now(),updated_by=$5
          where id=$1 and version=$2 and archived_at is null and item_section='general' returning id`,
        [row.itemId, row.itemVersion, row.nextName, row.nextCode, actor.userId]);
        if (updated.rowCount !== 1) throw stale();
        await client.query(`insert into "yu_inventory"."audit_records"
          (id,actor_id,actor_role_snapshot,subject_kind,subject_id,action,before_values,after_values,metadata)
          values($1,$2,'admin','item',$3,'item.audit_enrichment',$4::jsonb,$5::jsonb,$6::jsonb)`,
        [randomUUID(), actor.userId, row.itemId,
          JSON.stringify({ name: row.currentName, oneCCode: row.currentCode, version: row.itemVersion }),
          JSON.stringify({ name: row.nextName, oneCCode: row.nextCode, version: row.itemVersion + 1 }),
          JSON.stringify({ source: "inventory_audit_enrichment", batchId, runId: plan.runId, planHash: plan.planHash,
            externalId: row.externalId, excelRowNumber: row.excelRowNumber,
            nameSource: row.nameSource, codeStatus: row.codeStatus, result })]);
      }
      return result;
    });
  }

  private async plan(client: PoolClient, batchId: string, lock = false) {
    // A consistent transaction snapshot covers saved evidence and live sources.
    // Apply locks cards before reading the preview, so concurrent edits cannot
    // be overwritten even when they start after the HTTP permission check.
    const cards = await client.query(`select i.id,i.name,i.inventory_number,i.one_c_code,i.version,i.item_section,i.archived_at,
      coalesce((select array_agg(b.original_value order by b.original_value) from "yu_inventory"."barcode_registry" b
        where b.item_id=i.id and b.kind='official'),'{}') as barcodes
      from "yu_inventory"."items" i order by i.id ${lock ? "for update of i" : ""}`);
    const data = await exportInventorySourceAudit(client, batchId);
    const selection = await client.query(`select snapshot_id from "yu_inventory"."material_snapshot_selection" where id=1`);
    const registry = await client.query(`select external_id,payload_hash,payload from "yu_inventory"."one_c_fixed_asset_inbox" order by external_id`);
    const registryHash = createHash("sha256").update(registry.rows.map((row) => `${row.external_id}:${row.payload_hash}`).join("\n")).digest("hex");
    if (data.run.algorithm_version !== String(INVENTORY_SOURCE_AUDIT_ALGORITHM_VERSION)
      || data.run.inventory.stale || selection.rows[0]?.snapshot_id !== data.run.snapshot_id
      || registryHash !== data.run.one_c_registry_sha256) throw stale();
    const items: InventoryAuditEnrichmentItem[] = cards.rows.map((row) => ({ id: row.id, name: row.name,
      inventoryNumber: row.inventory_number, officialBarcodes: row.barcodes, oneCCode: row.one_c_code,
      version: row.version, itemSection: row.item_section, archivedAt: row.archived_at }));
    // Either copy can stop matching a card after its identifier changes.
    // Compare selected/current copies by external ID as well, so the audit's
    // matching filter cannot hide contradictory source evidence.
    const selected = await client.query(`select external_id,payload from "yu_inventory"."one_c_import_batch_rows" where batch_id=$1`, [batchId]);
    const currentById = new Map<string, OneCFixedAsset>(registry.rows.map((row) => [String(row.external_id), row.payload as OneCFixedAsset]));
    const selectedById = new Map<string, OneCFixedAsset>(selected.rows.map((row) => [String(row.external_id), row.payload as OneCFixedAsset]));
    const sourceCopies = [["current_registry", currentById], ["selected_batch", selectedById]] as const;
    const evidence = data.rows.map((row) => {
      const oneC = [...row.oneC];
      const included = new Set(oneC.flatMap((source) => source.origins.map((origin) => `${origin}:${source.externalId}`)));
      for (const source of row.oneC) {
        for (const [origin, copies] of sourceCopies) {
          const copy = copies.get(source.externalId), key = `${origin}:${source.externalId}`;
          if (!copy || included.has(key)) continue;
          oneC.push({ externalId: source.externalId, code: copy.code, inventoryNumber: copy.inventoryNumber,
            barcode: copy.barcode, name: copy.name, status: copy.status ?? "",
            origins: [origin], matchedBy: [], matchedBarcodes: [] });
          included.add(key);
        }
      }
      return { ...row, oneC };
    });
    const plan = buildInventoryAuditEnrichmentPlan(evidence, items);
    const planHash = createHash("sha256").update(JSON.stringify({ runId: data.run.id,
      registryHash, excelSha256: data.run.sha256, rows: plan.rows })).digest("hex");
    return { runId: String(data.run.id), planHash, ...plan };
  }

  private async transaction<T>(actor: OneCAdminActor, mutation: boolean, work: (client: PoolClient) => Promise<T>): Promise<T> {
    if (actor.role !== "admin") throw new ApplicationError("forbidden", "forbidden");
    const client = await this.pool.connect();
    try {
      await client.query(mutation ? "begin isolation level serializable" : "begin isolation level repeatable read");
      const currentActor = await client.query(`select role,is_active,deleted_at,version from "yu_inventory"."users" where id=$1 for share`, [actor.userId]);
      const user = currentActor.rows[0];
      if (!user || user.role !== "admin" || !user.is_active || user.deleted_at != null
        || (actor.sessionVersion !== undefined && user.version !== actor.sessionVersion)) throw new ApplicationError("forbidden", "forbidden");
      const result = await work(client);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      if (error && typeof error === "object" && "code" in error && ["40001", "40P01"].includes(String(error.code))) throw stale();
      throw error;
    } finally { client.release(); }
  }
}

function stale() { return new ApplicationError("conflict", "inventory_audit_enrichment_stale"); }
