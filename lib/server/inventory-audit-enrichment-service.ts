import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { getDatabasePool } from "@/lib/db/client";
import { ApplicationError } from "@/lib/domain/application-error";
import type { OneCFixedAsset } from "@/lib/contracts/one-c-fixed-assets";
import { buildInventoryAuditEnrichmentPlan, type InventoryAuditEnrichmentItem, type InventoryAuditEnrichmentPlan } from "@/lib/inventory-audit-enrichment";
import { buildInventorySourceAudit, INVENTORY_SOURCE_AUDIT_ALGORITHM_VERSION } from "@/lib/inventory-source-audit";
import { exportInventorySourceAudit } from "@/lib/server/inventory-source-audit-service";
import type { OneCAdminActor } from "@/lib/server/http/one-c-reconciliation-admin-handler";
import { readMaterialRegistry } from "@/lib/server/one-c-material-registry";
import type { ExcelSourceRow } from "@/lib/inventory-source-audit";
import { addOneCResponsibilityProposals, ONE_C_ALLOWED_RESPONSIBLES } from "@/lib/one-c-enrichment-responsibility";
import { createPostgresInventoryResponsibilityRepositories } from "@/lib/server/persistence/postgres/postgres-inventory-responsibility-repositories";
import { addOneCPriceProposals } from "@/lib/one-c-enrichment-price";
import { isInventoryResponsibleRole } from "@/lib/inventory-responsible-user";

type ApplyInput = { runId: string; planHash: string };
type ApplyResult = { updated: number; unchanged: number; skipped: number; planHash: string };

export class InventoryAuditEnrichmentService {
  constructor(private readonly pool: Pick<Pool, "connect"> = getDatabasePool()) {}

  preview(batchId: string, actor: OneCAdminActor) {
    return this.transaction(actor, false, (client) => this.plan(client, batchId));
  }

  previewCurrent(actor: OneCAdminActor) {
    return this.transaction(actor, false, (client) => this.currentPlan(client));
  }

  applyCurrent(input: ApplyInput, actor: OneCAdminActor): Promise<ApplyResult> {
    return this.transaction(actor, true, async (client) => {
      const previous = await client.query(`select metadata->'result' as result from "yu_inventory"."audit_records"
        where actor_id=$1 and action='item.audit_enrichment' and metadata->>'scope'='current_registry'
          and metadata->>'planHash'=$2 and metadata->>'runId'=$3 limit 1`, [actor.userId, input.planHash, input.runId]);
      if (previous.rows[0]) return previous.rows[0].result as ApplyResult;
      const plan = await this.currentPlan(client, true);
      if (plan.runId !== input.runId || plan.planHash !== input.planHash) throw stale();
      return this.writePlan(client, plan, actor, null);
    });
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
      return this.writePlan(client, plan, actor, batchId);
    });
  }

  private async writePlan(client: PoolClient, plan: InventoryAuditEnrichmentPlan & { runId: string; planHash: string }, actor: OneCAdminActor, batchId: string | null): Promise<ApplyResult> {
      const result: ApplyResult = { updated: plan.counts.ready, unchanged: plan.counts.unchanged, skipped: plan.counts.skipped, planHash: plan.planHash };
      for (const row of plan.rows.filter((entry) => entry.eligible && entry.changed)) {
        const rename = row.nextName !== row.currentName;
        // A code-only change must not invoke the UPDATE OF name identity trigger.
        const parameters: unknown[] = [row.itemId, row.itemVersion, row.nextCode, actor.userId];
        const assignments = ["one_c_code=$3", "version=version+1", "updated_at=now()", "updated_by=$4"];
        if (rename) { parameters.push(row.nextName); assignments.push(`name=$${parameters.length}`); }
        if (batchId === null && row.price?.changed) { parameters.push(row.price.nextUnitPrice); assignments.push(`unit_price=$${parameters.length}`); }
        const updated = await client.query(`update "yu_inventory"."items" set ${assignments.join(",")}
          where id=$1 and version=$2 and archived_at is null ${batchId === null ? "and status='active'" : "and item_section='general'"} returning id`, parameters);
        if (updated.rowCount !== 1) throw stale();
        if (batchId === null && row.responsibility?.changed) {
          const repository = createPostgresInventoryResponsibilityRepositories(client).responsibility;
          const state = await repository.findItemStateForUpdate(row.itemId);
          const targetId = row.responsibility.nextUserId;
          if (!state || state.responsibleUserId !== row.responsibility.currentUserId || !targetId
            || state.itemStatus === "decommissioned" || await repository.findPendingTransfer(row.itemId)) throw stale();
          const pendingTmc = await client.query(`select 1 from yu_inventory.tmc_transfer_request_items i
            join yu_inventory.tmc_transfer_requests r on r.id=i.request_id
            where i.item_id=$1 and i.result='pending' and r.status='pending' limit 1`, [row.itemId]);
          if (pendingTmc.rowCount) throw stale();
          const target = await repository.findAuthorizationUserForUpdate(targetId);
          if (!target || !target.active || target.deletedAt || !isInventoryResponsibleRole(target.role)) throw stale();
          const occurredAt = new Date();
          const reason = "Сверка 1С: назначение разрешённого ответственного по подтверждённому номеру или штрихкоду";
          if (state.responsibilityPeriodId && state.responsibleUserId) {
            if (!await repository.closeResponsibility({ itemId: row.itemId, expectedResponsibilityPeriodId: state.responsibilityPeriodId,
              expectedResponsibleUserId: state.responsibleUserId, endedBy: actor.userId, endedAt: occurredAt, endReason: reason })) throw stale();
          }
          await repository.insertResponsibility({ id: randomUUID(), itemId: row.itemId, responsibleUserId: targetId,
            source: "admin_override", startedBy: actor.userId, startedAt: occurredAt });
          await repository.appendAudit({ id: randomUUID(), actorId: actor.userId, actorRole: actor.role,
            subjectKind: "responsibility", subjectId: row.itemId, subjectRevision: row.itemVersion + 1,
            action: "responsibility.admin_override", beforeValues: { responsibleUserId: state.responsibleUserId },
            afterValues: { responsibleUserId: targetId, source: "admin_override", origin: "one_c_current_enrichment" },
            reason, isAdministrativeException: true, occurredAt });
        }
        await client.query(`insert into "yu_inventory"."audit_records"
          (id,actor_id,actor_role_snapshot,subject_kind,subject_id,action,before_values,after_values,metadata)
          values($1,$2,'admin','item',$3,'item.audit_enrichment',$4::jsonb,$5::jsonb,$6::jsonb)`,
        [randomUUID(), actor.userId, row.itemId,
          JSON.stringify({ name: row.currentName, oneCCode: row.currentCode, version: row.itemVersion, ...(row.price ? { unitPrice: row.price.currentUnitPrice } : {}), ...(row.responsibility ? { responsibleUserId: row.responsibility.currentUserId } : {}) }),
          JSON.stringify({ name: row.nextName, oneCCode: row.nextCode, version: row.itemVersion + 1, ...(row.price ? { unitPrice: row.price.nextUnitPrice } : {}), ...(row.responsibility ? { responsibleUserId: row.responsibility.nextUserId } : {}) }),
          JSON.stringify({ source: "inventory_audit_enrichment", batchId, runId: plan.runId, planHash: plan.planHash,
            scope: batchId === null ? "current_registry" : "selected_batch",
            externalId: row.externalId, excelRowNumber: row.excelRowNumber,
            nameSource: row.nameSource, codeStatus: row.codeStatus, result })]);
      }
      return result;
  }

  /** One live comparison across all OS and MP, independent of batch analysis/history. */
  private async currentPlan(client: PoolClient, lock = false) {
    const cards = await client.query(`select i.id,i.name,i.inventory_number,i.inventory_number_kind,i.one_c_code,i.version,i.item_section,i.archived_at,i.status,i.unit_price,i.quantity,
      coalesce((select array_agg(b.original_value order by b.original_value) from yu_inventory.barcode_registry b
        where b.item_id=i.id and b.kind='official'),'{}') as barcodes,
      coalesce((select array_agg(g.barcode_value order by g.barcode_value) from yu_inventory.local_item_groups g
        where g.item_id=i.id and g.status='active'),'{}') as local_barcodes
      from yu_inventory.items i order by i.id ${lock ? "for update of i" : ""}`);
    const registry = await client.query(`select external_id,payload from yu_inventory.one_c_fixed_asset_inbox where payload->>'status' = 'Принято к учёту' order by external_id`);
    const materials = await readMaterialRegistry(client);
    const links = await client.query(`select external_id,item_id,source_code from yu_inventory.item_one_c_links order by external_id`);
    const codes = new Map<string, string[]>();
    for (const link of links.rows) if (link.source_code) codes.set(link.item_id, [...(codes.get(link.item_id) ?? []), link.source_code]);
    const currentCards = cards.rows.filter(row => row.archived_at == null && row.status === "active");
    const audit = buildInventorySourceAudit(currentCards.map(row => ({
      id: row.id, name: row.name, inventoryNumber: row.inventory_number, inventoryNumberKind: row.inventory_number_kind,
      oneCCode: row.one_c_code, version: row.version, officialBarcodes: row.barcodes, localBarcodes: row.local_barcodes,
      sourceCodes: codes.get(row.id) ?? [],
    })), registry.rows.map(row => ({ externalId: String(row.external_id), asset: row.payload as OneCFixedAsset, origins: ["current_registry" as const] })),
    materials.rows, links.rows.map(row => ({ externalId: String(row.external_id), itemId: String(row.item_id) })), { descriptionBarcodes: true, formattedNumbers: true });
    // Inspect all balances of each candidate, so a conflicting MOL/account row
    // cannot disappear merely because its number did not match the site card.
    const balances = new Map<string, ExcelSourceRow[]>();
    for (const row of materials.rows) if (row.oneCCode) balances.set(row.oneCCode, [...(balances.get(row.oneCCode) ?? []), row]);
    const evidence = audit.rows.map(row => {
      const excel = [...row.excel];
      const included = new Set(excel.map(entry => entry.sourceKey));
      for (const entry of row.excel) for (const balance of balances.get(entry.oneCCode ?? "") ?? []) {
        if (included.has(balance.sourceKey)) continue;
        included.add(balance.sourceKey);
        excel.push(balance);
      }
      return { ...row, excel };
    });
    const items: InventoryAuditEnrichmentItem[] = currentCards.map(row => ({
      id: row.id, name: row.name, inventoryNumber: row.inventory_number, officialBarcodes: row.barcodes,
      oneCCode: row.one_c_code, version: row.version, itemSection: row.item_section,
      status: row.status, unitPrice: row.unit_price, quantity: row.quantity,
    }));
    const plan = buildInventoryAuditEnrichmentPlan(evidence, items, { allowDescriptionIdentity: true, includeIt: true, formattedNumbers: true });
    await this.checkSharedNumbers(client, plan);
    const users = await client.query(`select id,full_name,role,is_active,deleted_at,version from yu_inventory.users order by id ${lock ? "for share" : ""}`);
    const periods = await client.query(`select p.id,p.item_id,p.responsible_user_id,u.full_name from yu_inventory.responsibility_periods p
      join yu_inventory.users u on u.id=p.responsible_user_id where p.ended_at is null order by p.id ${lock ? "for update of p" : ""}`);
    const pending = await client.query(`select 'legacy' as source,id,item_id,version,null::uuid as request_id,null::integer as request_version
      from yu_inventory.transfers where status='pending_current_owner'
      union all
      select 'tmc' as source,i.id,i.item_id,i.version,r.id as request_id,r.version as request_version
      from yu_inventory.tmc_transfer_request_items i join yu_inventory.tmc_transfer_requests r on r.id=i.request_id
      where i.result='pending' and r.status='pending'
      order by source,id`);
    const byPeriod = new Map(periods.rows.map(row => [row.item_id, row]));
    const pendingIds = new Set(pending.rows.map(row => row.item_id));
    const status = await client.query(`select id,status from yu_inventory.items order by id`);
    const unavailable = new Set(status.rows.filter(row => row.status === "decommissioned").map(row => row.id));
    addOneCResponsibilityProposals(plan, evidence, new Map(registry.rows.map(row => [String(row.external_id), (row.payload as OneCFixedAsset).responsibleName])),
      users.rows.map(row => ({ id: String(row.id), fullName: String(row.full_name), role: row.role, active: row.is_active, deleted: row.deleted_at != null })),
      currentCards.map(row => ({ itemId: String(row.id), userId: byPeriod.get(row.id)?.responsible_user_id ?? null,
        name: byPeriod.get(row.id)?.full_name ?? null, pendingTransfer: pendingIds.has(row.id), unavailable: unavailable.has(row.id) })));
    addOneCPriceProposals(plan, evidence, new Map(registry.rows.map(row => [String(row.external_id), row.payload as OneCFixedAsset])), items);
    const runId = "current-registry";
    const planHash = createHash("sha256").update(JSON.stringify({
      scope: runId, algorithm: INVENTORY_SOURCE_AUDIT_ALGORITHM_VERSION,
      registry: registry.rows, materialRegistrySha256: materials.metadata.sha256,
      materialBatchId: materials.metadata.batchId, cards: cards.rows, links: links.rows, rows: plan.rows,
      responsibility: { users: users.rows, periods: periods.rows, pending: pending.rows, status: status.rows },
    })).digest("hex");
    return { runId, planHash, ...plan, allowedResponsibles: ONE_C_ALLOWED_RESPONSIBLES, sources: {
      fixedAssets: registry.rows.length, materials: new Set(materials.rows.map(row => row.oneCCode)).size,
      materialBalances: materials.rows.length, cards: currentCards.length,
    } };
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
    const materials = await readMaterialRegistry(client);
    const materialSource = materials.metadata;
    const registry = await client.query(`select external_id,payload_hash,payload from "yu_inventory"."one_c_fixed_asset_inbox" order by external_id`);
    const registryHash = createHash("sha256").update(registry.rows.map((row) => `${row.external_id}:${row.payload_hash}`).join("\n")).digest("hex");
    if (data.run.algorithm_version !== String(INVENTORY_SOURCE_AUDIT_ALGORITHM_VERSION)
      || data.run.inventory.stale || !data.run.material_source
      || (data.run.material_source as { sha256?: string }).sha256 !== materialSource.sha256
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
    const materialBalancesByCode = new Map<string, ExcelSourceRow[]>();
    for (const balance of materials.rows) {
      if (!balance.oneCCode) continue;
      const balances = materialBalancesByCode.get(balance.oneCCode) ?? [];
      balances.push(balance);
      materialBalancesByCode.set(balance.oneCCode, balances);
    }
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
      // Number matching can omit a contradictory MOL/account balance before a
      // card has a code. Recheck every positive balance of each matched material,
      // not just the subset that happened to match this card's identifiers.
      const excel = [...row.excel];
      const includedBalances = new Set(excel.map(entry => entry.sourceKey));
      for (const entry of row.excel) {
        if (entry.sourceKind !== "materials_api" || !entry.oneCCode) continue;
        for (const balance of materialBalancesByCode.get(entry.oneCCode) ?? []) {
          if (includedBalances.has(balance.sourceKey)) continue;
          includedBalances.add(balance.sourceKey);
          excel.push(balance);
        }
      }
      return { ...row, oneC, excel };
    });
    const plan = buildInventoryAuditEnrichmentPlan(evidence, items);
    await this.checkSharedNumbers(client, plan);
    const planHash = createHash("sha256").update(JSON.stringify({ runId: data.run.id,
      registryHash, materialRegistrySha256: materialSource.sha256, rows: plan.rows })).digest("hex");
    return { runId: String(data.run.id), planHash, ...plan };
  }

  private async checkSharedNumbers(client: PoolClient, plan: InventoryAuditEnrichmentPlan) {
    const renames = plan.rows.filter((row) => row.eligible && row.changed && row.nextName !== row.currentName)
      .map((row) => ({ id: row.itemId, next_name: row.nextName }));
    if (!renames.length) return;
    // Use the database's classifier and stored identity key, including archived
    // peers. Both intermediate and final names must satisfy the trigger so the
    // result does not depend on which card is updated first.
    const conflicts = await client.query<{ id: string }>(`with proposed as (
        select * from jsonb_to_recordset($1::jsonb) as p(id uuid,next_name text)
      )
      select target.id from proposed p join "yu_inventory"."items" target on target.id=p.id
      cross join lateral (
        select count(*) as peer_count,
          min("yu_inventory"."inventory_shared_number_device"(other.name)) as current_device,
          min("yu_inventory"."inventory_shared_number_device"(coalesce(next.next_name,other.name))) as next_device
        from "yu_inventory"."items" other left join proposed next on next.id=other.id
        where other.inventory_number_key=target.inventory_number_key and other.id<>target.id
      ) peers
      where not (target.item_section='general' and target.item_type='components'
        and target.inventory_number='' and target.inventory_number_key='')
      and (peers.peer_count=0 or (peers.peer_count=1
        and "yu_inventory"."inventory_shared_number_device"(p.next_name)<>peers.current_device
        and "yu_inventory"."inventory_shared_number_device"(p.next_name)<>peers.next_device)) is not true`,
    [JSON.stringify(renames)]);
    const blocked = new Set(conflicts.rows.map((row) => row.id));
    for (const row of plan.rows) {
      if (!blocked.has(row.itemId)) continue;
      row.eligible = false;
      row.changed = false;
      row.reason = "shared_number_conflict";
      row.nextName = row.currentName;
      row.nextCode = row.currentCode;
      plan.counts.ready--;
      plan.counts.skipped++;
    }
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
      if (error instanceof Error && "code" in error && error.code === "23505"
        && error.message === "inventory number duplicate is allowed only for one monitor and one system unit") {
        throw new ApplicationError("conflict", "inventory_audit_enrichment_shared_number_conflict");
      }
      throw error;
    } finally { client.release(); }
  }
}

function stale() { return new ApplicationError("conflict", "inventory_audit_enrichment_stale"); }
