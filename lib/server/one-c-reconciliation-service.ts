import "server-only";

import { randomBytes, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { getDatabasePool } from "@/lib/db/client";
import { ApplicationError } from "@/lib/domain/application-error";
import { inventoryNumberComparisonKey } from "@/lib/domain/code39";
import { qrIdentifierFromEntropy } from "@/lib/domain/qr-identifier";
import { analyzeOneCFixedAsset, buildOneCPublicationPlan } from "@/lib/one-c-reconciliation";
import type { OneCFixedAsset } from "@/lib/contracts/one-c-fixed-assets";
import type { OneCReconciliationAdminService, OneCAdminActor, OneCBatchListQuery, OneCBatchRowsQuery, OneCDecisionInput, OneCBulkDecisionInput, OneCPlanInput } from "@/lib/server/http/one-c-reconciliation-admin-handler";

type Row = Record<string, unknown>;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type CandidateReason = "guid" | "code" | "inventory_number";
type ReconciliationCandidate = {
  id: string;
  name: string;
  inventoryNumber: string;
  oneCCode: string | null;
  status: string;
  version: number;
  matchedBy: CandidateReason[];
};

export type OneCDecommissionedAsset = {
  externalId: string;
  code: string | null;
  inventoryNumber: string | null;
  name: string;
  location: string | null;
  responsibleName: string | null;
  residualCost: string | null;
  lastSeenAt: string | null;
  linkedItemId: string | null;
  linkedItemName: string | null;
  linkedItemStatus: string | null;
};

export type OneCDecommissionedAssetPage = {
  data: OneCDecommissionedAsset[];
  page: number;
  pageSize: number;
  total: number;
};

export class OneCReconciliationService implements OneCReconciliationAdminService {
  constructor(private readonly pool: Pick<Pool, "query" | "connect"> = getDatabasePool()) {}

  async listBatches(query: OneCBatchListQuery, actor?: OneCAdminActor) {
    void actor;
    const values: unknown[] = [];
    const where = query.state ? `where state = $${values.push(query.state)}` : "";
    values.push(query.pageSize, (query.page - 1) * query.pageSize);
    const result = await this.pool.query(`select *, count(*) over()::int as total from "yu_inventory"."one_c_import_batches" ${where} order by received_at desc, id limit $${values.length - 1} offset $${values.length}`, values);
    return { data: result.rows, page: query.page, pageSize: query.pageSize, total: Number(result.rows[0]?.total ?? 0) };
  }

  async listDecommissionedAssets(query: {
    page: number;
    pageSize: number;
    search?: string;
  }): Promise<OneCDecommissionedAssetPage> {
    const page = Math.max(1, Math.trunc(query.page));
    const pageSize = Math.min(100, Math.max(1, Math.trunc(query.pageSize)));
    const values: unknown[] = ["Снято с учёта"];
    const clauses = ["inbox.payload->>'status' = $1"];
    const search = query.search?.normalize("NFKC").trim();
    if (search) {
      values.push(`%${escapeLikePattern(search)}%`);
      clauses.push(`(inbox.external_id ilike $${values.length} escape '\\'
        or coalesce(inbox.payload->>'code','') ilike $${values.length} escape '\\'
        or coalesce(inbox.payload->>'inventoryNumber','') ilike $${values.length} escape '\\'
        or coalesce(inbox.payload->>'name','') ilike $${values.length} escape '\\'
        or coalesce(inbox.payload->>'location','') ilike $${values.length} escape '\\'
        or coalesce(inbox.payload->>'responsibleName','') ilike $${values.length} escape '\\')`);
    }
    values.push(pageSize, (page - 1) * pageSize);
    const result = await this.pool.query(
      `select inbox.external_id,
              inbox.payload->>'code' as code,
              inbox.payload->>'inventoryNumber' as inventory_number,
              inbox.payload->>'name' as name,
              inbox.payload->>'location' as location,
              inbox.payload->>'responsibleName' as responsible_name,
              inbox.payload->>'residualCost' as residual_cost,
              coalesce(inbox.last_seen_at, inbox.received_at) as last_seen_at,
              link.item_id as linked_item_id,
              item.name as linked_item_name,
              item.status::text as linked_item_status,
              count(*) over()::int as total
         from "yu_inventory"."one_c_fixed_asset_inbox" inbox
         left join "yu_inventory"."item_one_c_links" link on link.external_id = inbox.external_id
         left join "yu_inventory"."items" item on item.id = link.item_id
        where ${clauses.join(" and ")}
        order by coalesce(inbox.payload->>'code',''), inbox.external_id
        limit $${values.length - 1} offset $${values.length}`,
      values,
    );
    return {
      data: result.rows.map((row) => ({
        externalId: String(row.external_id),
        code: stringOrNull(row.code),
        inventoryNumber: stringOrNull(row.inventory_number),
        name: String(row.name),
        location: stringOrNull(row.location),
        responsibleName: stringOrNull(row.responsible_name),
        residualCost: stringOrNull(row.residual_cost),
        lastSeenAt: row.last_seen_at instanceof Date
          ? row.last_seen_at.toISOString()
          : stringOrNull(row.last_seen_at),
        linkedItemId: stringOrNull(row.linked_item_id),
        linkedItemName: stringOrNull(row.linked_item_name),
        linkedItemStatus: stringOrNull(row.linked_item_status),
      })),
      page,
      pageSize,
      total: Number(result.rows[0]?.total ?? 0),
    };
  }

  async getBatch(batchId: string) {
    const result = await this.pool.query(`select * from "yu_inventory"."one_c_import_batches" where id = $1`, [batchId]);
    if (!result.rows[0]) throw notFound();
    return result.rows[0];
  }

  async listBatchRows(batchId: string, query: OneCBatchRowsQuery) {
    await this.assertBatch(batchId);
    const values: unknown[] = [batchId];
    const clauses = ["r.batch_id = $1"];
    if (query.reviewState) clauses.push(`r.review_state = $${values.push(query.reviewState)}`);
    if (query.proposedAction) clauses.push(`r.proposed_action = $${values.push(query.proposedAction)}`);
    if (query.search) {
      values.push(`%${query.search}%`);
      clauses.push(`(r.external_id ilike $${values.length}
        or r.payload->>'code' ilike $${values.length}
        or r.payload->>'name' ilike $${values.length}
        or r.payload->>'inventoryNumber' ilike $${values.length}
        or r.payload->>'barcode' ilike $${values.length}
        or r.payload->>'location' ilike $${values.length}
        or r.payload->>'responsibleName' ilike $${values.length})`);
    }
    values.push(query.pageSize, (query.page - 1) * query.pageSize);
    const result = await this.pool.query(`select r.*, i.name as matched_item_name, i.inventory_number as matched_inventory_number, count(*) over()::int as total from "yu_inventory"."one_c_import_batch_rows" r left join "yu_inventory"."items" i on i.id=r.matched_item_id where ${clauses.join(" and ")} order by r.external_id limit $${values.length - 1} offset $${values.length}`, values);
    return { data: result.rows, page: query.page, pageSize: query.pageSize, total: Number(result.rows[0]?.total ?? 0) };
  }

  async getRowCandidates(batchId: string, externalId: string) {
    return this.findRowCandidates(this.pool, batchId, externalId);
  }

  async exportBatch(batchId: string, actor?: OneCAdminActor) {
    void actor;
    const [batch, rows] = await Promise.all([
      this.pool.query(`select * from "yu_inventory"."one_c_import_batches" where id = $1`, [batchId]),
      this.pool.query(`select r.*, i.name as matched_item_name, i.inventory_number as matched_inventory_number
        from "yu_inventory"."one_c_import_batch_rows" r
        left join "yu_inventory"."items" i on i.id = r.matched_item_id
        where r.batch_id = $1
        order by r.external_id`, [batchId]),
    ]);
    if (!batch.rows[0]) throw notFound();
    return { batch: batch.rows[0], rows: rows.rows };
  }

  async analyzeBatch(batchId: string, input: OneCPlanInput) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const batch = await this.lockBatch(client, batchId, input.version, ["received", "review_required", "failed"]);
      await client.query(`update "yu_inventory"."one_c_import_batches" set state='analyzing' where id=$1`, [batchId]);
      const [rows, candidates, links] = await Promise.all([
        client.query(`select * from "yu_inventory"."one_c_import_batch_rows" where batch_id=$1 order by external_id`, [batchId]),
        client.query(`select i.id, i.inventory_number, i.one_c_code, i.version, coalesce(array_agg(br.original_value) filter (where br.kind='official'), '{}') as official_barcodes from "yu_inventory"."items" i left join "yu_inventory"."barcode_registry" br on br.item_id=i.id where i.item_section='general' group by i.id`),
        client.query(`select external_id,item_id,source_code from "yu_inventory"."item_one_c_links"`),
      ]);
      const itemCandidates = candidates.rows.map((r) => ({ id: String(r.id), inventoryNumber: String(r.inventory_number), officialBarcodes: r.official_barcodes as string[] }));
      const linkMap = new Map(links.rows.map((r) => [String(r.external_id), String(r.item_id)]));
      const itemLinkMap = new Map(links.rows.map((r) => [String(r.item_id), String(r.external_id)]));
      const codeLinkMap = new Map<string, string[]>();
      for (const link of links.rows) {
        const key = oneCCodeComparisonKey(link.source_code);
        if (key) codeLinkMap.set(key, [...(codeLinkMap.get(key) ?? []), String(link.item_id)]);
      }
      const planRows = [];
      const summary: Record<string, number> = { matched: 0, create: 0, conflicts: 0, blocked: 0, excluded: 0 };
      for (const row of rows.rows) {
        const asset = row.payload as OneCFixedAsset;
        const decision = (row.decision ?? {}) as Row;
        const selectedItemId = decision.confirmLink === true ? stringOrNull(decision.itemId) : null;
        const selectedCandidate = selectedItemId
          ? candidates.rows.find((candidate) => String(candidate.id) === selectedItemId)
          : null;
        const selectedReasons = selectedCandidate
          ? exactCandidateReasons(asset, selectedCandidate, linkMap.get(asset.externalId), codeLinkMap)
          : [];
        const requestedManualSelection = decision.confirmLink === true && selectedItemId !== null;
        const actualLinkedItemId = linkMap.get(asset.externalId);
        const selectedItemExternalId = selectedItemId ? itemLinkMap.get(selectedItemId) : undefined;
        const expectedItemVersion = Number(decision.expectedItemVersion);
        const versionMatches = Boolean(selectedCandidate) && Number.isInteger(expectedItemVersion) && expectedItemVersion === Number(selectedCandidate?.version);
        const linkOccupancyMatches = (!actualLinkedItemId || actualLinkedItemId === selectedItemId)
          && (!selectedItemExternalId || selectedItemExternalId === asset.externalId);
        const manualSelectionValid = Boolean(selectedCandidate && selectedReasons.length && versionMatches && linkOccupancyMatches);
        const analysis = analyzeOneCFixedAsset(asset, { items: itemCandidates, linkedItemId: manualSelectionValid ? selectedItemId : linkMap.get(asset.externalId), selectedRoomId: stringOrNull(decision.roomId), selectedItemType: stringOrNull(decision.itemType), zeroResidualValueConfirmed: decision.confirmZeroResidual === true, emptyResponsibleConfirmed: decision.confirmUnassigned === true });
        let mapped = workflowFor(analysis.result, analysis.identifiers.itemId);
        if (decision.exclude === true) {
          mapped = { state: "excluded", action: "exclude", planAction: "exclude", bucket: "excluded" };
        } else if (mapped.action === "create" && decision.confirmCreate === true && decision.confirmConditionDefault === true) {
          mapped = { ...mapped, state: "approved" };
        } else if (requestedManualSelection && !manualSelectionValid) {
          mapped = { state: "blocked", action: "manual_review", planAction: "blocked", bucket: "blocked" };
        } else if (manualSelectionValid && manualLinkHasNoUnresolvedBlockingIssues(analysis.issues)) {
          mapped = { state: "approved", action: "link", planAction: "link", bucket: "matched" };
        } else if (mapped.action === "link" && decision.confirmLink === true) {
          mapped = { ...mapped, state: "approved" };
        }
        const matchedItemId = manualSelectionValid ? selectedItemId : analysis.identifiers.itemId;
        const matchMethod = manualSelectionValid ? `manual_${selectedReasons.join("+")}` : analysis.identifiers.status;
        summary[mapped.bucket] += 1;
        await client.query(`update "yu_inventory"."one_c_import_batch_rows" set review_state=$3,proposed_action=$4,matched_item_id=$5,match_method=$6,issues=$7::jsonb where batch_id=$1 and external_id=$2`, [batchId, asset.externalId, mapped.state, mapped.action, matchedItemId, matchMethod, JSON.stringify(analysis.issues)]);
        planRows.push({ externalId: asset.externalId, action: mapped.planAction, itemId: matchedItemId, itemVersion: candidates.rows.find((candidate) => String(candidate.id) === matchedItemId)?.version ?? null, decisionVersion: batch.version, inventoryNumber: asset.inventoryNumber, barcode: asset.barcode });
      }
      const versionFingerprint = candidates.rows.map((r) => `${r.id}:${r.version}`).sort().join("|");
      const plan = buildOneCPublicationPlan({ batchId, sourceHash: String(batch.source_sha256), existingItemsVersion: versionFingerprint, rows: planRows });
      const existingSummary = typeof batch.summary === "object" && batch.summary !== null
        ? batch.summary as Record<string, unknown>
        : {};
      await client.query(`update "yu_inventory"."one_c_import_batches" set state='review_required',review_started_at=coalesce(review_started_at,now()),summary=$2::jsonb,version=version+1 where id=$1`, [batchId, JSON.stringify({ ...existingSummary, ...summary, plan })]);
      await client.query("commit");
      return plan;
    } catch (error) { await client.query("rollback").catch(() => undefined); throw error; }
    finally { client.release(); }
  }

  async decideRow(batchId: string, externalId: string, input: OneCDecisionInput, actor: OneCAdminActor) {
    return this.withDecision(batchId, input.version, actor, async (client) => {
      let normalizedDecision = input.decision;
      if (input.decision.confirmLink === true) {
        const itemId = stringOrNull(input.decision.itemId);
        if (!itemId || !UUID_PATTERN.test(itemId)) throw new ApplicationError("validation", "invalid_link_candidate");
        const candidates = await this.findRowCandidates(client, batchId, externalId);
        const selected = candidates.find((candidate) => candidate.id === itemId);
        if (!selected) throw new ApplicationError("conflict", "link_candidate_no_longer_matches");
        const expectedVersion = input.decision.expectedItemVersion;
        if (expectedVersion !== undefined && expectedVersion !== selected.version) throw new ApplicationError("conflict", "link_candidate_version_changed");
        const conflictingLink = await client.query(`select external_id,item_id from "yu_inventory"."item_one_c_links" where (item_id=$1 and external_id<>$2) or (external_id=$2 and item_id<>$1) limit 1 for update`, [itemId, externalId]);
        if (conflictingLink.rows[0]) throw new ApplicationError("conflict", "link_candidate_already_connected");
        normalizedDecision = { ...input.decision, itemId, expectedItemVersion: selected.version, matchedBy: selected.matchedBy };
      }
      const updated = await client.query(`update "yu_inventory"."one_c_import_batch_rows" set decision=$4::jsonb,decided_by=$3,decided_at=now(),review_state='pending' where batch_id=$1 and external_id=$2 returning *`, [batchId, externalId, actor.userId, JSON.stringify(normalizedDecision)]);
      if (!updated.rows[0]) throw notFound();
      return updated.rows[0];
    });
  }

  async decideRowsBulk(batchId: string, input: OneCBulkDecisionInput, actor: OneCAdminActor) {
    if (input.decision.confirmLink !== undefined || input.decision.itemId !== undefined || input.decision.expectedItemVersion !== undefined || input.decision.matchedBy !== undefined) {
      throw new ApplicationError("validation", "bulk_manual_link_not_allowed");
    }
    return this.withDecision(batchId, input.version, actor, async (client) => {
      const result = await client.query(`update "yu_inventory"."one_c_import_batch_rows" set decision=coalesce(decision,'{}'::jsonb)||$4::jsonb,decided_by=$3,decided_at=now(),review_state='pending' where batch_id=$1 and external_id=any($2::text[]) and review_state not in ('conflict','published') returning external_id`, [batchId, input.externalIds, actor.userId, JSON.stringify(input.decision)]);
      if (result.rowCount !== input.externalIds.length) throw new ApplicationError("conflict", "bulk_contains_ineligible_rows");
      return { updated: result.rowCount };
    });
  }

  async approveBatch(batchId: string, input: Required<OneCPlanInput>, actor: OneCAdminActor) {
    const result = await this.pool.query(`update "yu_inventory"."one_c_import_batches" set state='approved',approved_at=now(),approved_by=$3,version=version+1 where id=$1 and version=$2 and state='review_required' and summary->'plan'->>'hash'=$4 and coalesce((summary->>'massPublicationBlocked')::boolean,false)=false and not (request_id is null and source_filename is null) and not exists(select 1 from "yu_inventory"."one_c_import_batch_rows" where batch_id=$1 and review_state not in ('excluded','approved','published')) returning *`, [batchId, input.version, actor.userId, input.planHash]);
    if (!result.rows[0]) throw new ApplicationError("conflict", "batch_not_approvable");
    return result.rows[0];
  }

  async publishBatch(batchId: string, input: Required<OneCPlanInput> & { idempotencyKey: string }, actor: OneCAdminActor) {
    const existing = await this.pool.query(`select * from "yu_inventory"."one_c_publication_runs" where idempotency_key=$1`, [input.idempotencyKey]);
    if (existing.rows[0]) {
      if(String(existing.rows[0].batch_id)!==batchId)throw new ApplicationError("conflict","idempotency_key_reused");
      return existing.rows[0];
    }
    const runId = randomUUID();
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(`select pg_advisory_xact_lock(hashtextextended($1,731005))`,[batchId]);
      const replay=await client.query(`select * from "yu_inventory"."one_c_publication_runs" where idempotency_key=$1`,[input.idempotencyKey]);
      if(replay.rows[0]){if(String(replay.rows[0].batch_id)!==batchId)throw new ApplicationError("conflict","idempotency_key_reused");await client.query("commit");return replay.rows[0];}
      const batch = await client.query(`update "yu_inventory"."one_c_import_batches" set state='publishing',version=version+1 where id=$1 and version=$2 and state='approved' and summary->'plan'->>'hash'=$3 returning *`, [batchId, input.version, input.planHash]);
      if (!batch.rows[0]) throw new ApplicationError("precondition_failed", "publication_plan_stale");
      const run=await client.query(`insert into "yu_inventory"."one_c_publication_runs"(id,batch_id,idempotency_key,state,requested_by) values($1,$2,$3,'pending',$4) returning *`, [runId, batchId, input.idempotencyKey, actor.userId]);
      await client.query("commit");
      return run.rows[0];
    } catch(error){
      await client.query("rollback").catch(()=>undefined);
      if(isPgUniqueViolation(error)){
        const replay=await this.pool.query(`select * from "yu_inventory"."one_c_publication_runs" where idempotency_key=$1`,[input.idempotencyKey]);
        if(replay.rows[0]){if(String(replay.rows[0].batch_id)!==batchId)throw new ApplicationError("conflict","idempotency_key_reused");return replay.rows[0];}
      }
      throw error;
    } finally { client.release(); }
  }

  async processNextPublication():Promise<boolean>{
    const run=await this.pool.query(`select id,batch_id,requested_by from "yu_inventory"."one_c_publication_runs" where state in ('pending','running') order by started_at,id limit 1`);
    const pending=run.rows[0];if(!pending)return false;
    const client=await this.pool.connect();
    try{
      const lock=await client.query<{acquired:boolean}>(`select pg_try_advisory_lock(hashtextextended($1,731005)) acquired`,[pending.batch_id]);if(!lock.rows[0]?.acquired)return false;
      await client.query(`update "yu_inventory"."one_c_publication_runs" set state='running' where id=$1 and state='pending'`,[pending.id]);
      const rows=await client.query(`select * from "yu_inventory"."one_c_import_batch_rows" where batch_id=$1 and review_state='approved' order by external_id limit 100`,[pending.batch_id]);
      const counts={created:0,linked:0,updated:0,skipped:0,failed:0};const actor={userId:String(pending.requested_by),role:"admin" as const};
      for(const row of rows.rows){try{const outcome=await this.publishRow(client,String(pending.batch_id),row,actor);counts[outcome]+=1;}catch{counts.failed+=1;await client.query(`update "yu_inventory"."one_c_import_batch_rows" set review_state='failed',proposed_action='manual_review' where batch_id=$1 and external_id=$2`,[pending.batch_id,row.external_id]);}}
      await client.query(`update "yu_inventory"."one_c_publication_runs" set created_items=created_items+$2,linked_items=linked_items+$3,updated_items=updated_items+$4,skipped_items=skipped_items+$5,failed_items=failed_items+$6 where id=$1`,[pending.id,counts.created,counts.linked,counts.updated,counts.skipped,counts.failed]);
      const remaining=await client.query<{count:number}>(`select count(*)::int count from "yu_inventory"."one_c_import_batch_rows" where batch_id=$1 and review_state='approved'`,[pending.batch_id]);
      if(Number(remaining.rows[0]?.count??0)===0){const totals=await client.query<{failed_items:number}>(`select failed_items from "yu_inventory"."one_c_publication_runs" where id=$1`,[pending.id]);const state=Number(totals.rows[0]?.failed_items??0)>0?"failed":"completed";await client.query(`update "yu_inventory"."one_c_publication_runs" set state=$2,finished_at=now() where id=$1`,[pending.id,state]);await client.query(`update "yu_inventory"."one_c_import_batches" set state=$2,published_at=case when $2='published' then now() end,published_by=$3 where id=$1`,[pending.batch_id,state==="completed"?"published":"failed",pending.requested_by]);}
      return true;
    }finally{await client.query(`select pg_advisory_unlock(hashtextextended($1,731005))`,[pending.batch_id]).catch(()=>undefined);client.release();}
  }

  async getPublication(publicationId: string) {
    const result = await this.pool.query(`select * from "yu_inventory"."one_c_publication_runs" where id=$1`, [publicationId]);
    if (!result.rows[0]) throw notFound();
    return result.rows[0];
  }

  private async publishRow(client: PoolClient, batchId: string, row: Row, actor: OneCAdminActor): Promise<"created" | "linked" | "updated" | "skipped"> {
    await client.query("begin");
    try {
      const asset = row.payload as OneCFixedAsset; const decision = (row.decision ?? {}) as Row;
      let itemId = stringOrNull(row.matched_item_id);
      let outcome: "created" | "linked" | "updated" | "skipped" = "skipped";
      if (row.proposed_action === "create") {
        const roomId = stringOrNull(decision.roomId); const itemType = stringOrNull(decision.itemType);
        if (!roomId || !itemType || !asset.inventoryNumber || asset.quantity !== 1 || decision.confirmCreate !== true || decision.confirmConditionDefault !== true) throw new Error("create_not_confirmed");
        itemId = randomUUID();
        await client.query(`insert into "yu_inventory"."items"(id,name,item_type,item_section,quantity,unit_price,room_id,inventory_number_kind,inventory_number,inventory_number_key,status,condition,connection_status,created_by,updated_by) values($1,$2,$3,'general',1,0,$4,'official',$5,$6,$7,'good','not_applicable',$8,$8)`, [itemId, asset.name, itemType, roomId, asset.inventoryNumber, inventoryNumberComparisonKey(asset.inventoryNumber), asset.status === "Принято к учёту" ? "active" : "maintenance", actor.userId]);
        const qr = qrIdentifierFromEntropy(randomBytes(16));
        await client.query(`insert into "yu_inventory"."qr_identifiers"(id,original_value,canonical_key,format,target_kind,role,status,item_id,created_by) values($1,$2,$2,'generated_v1','item','primary','active',$3,$4)`, [randomUUID(), qr, itemId, actor.userId]);
        outcome = "created";
      } else if (row.proposed_action === "link" || row.proposed_action === "no_change" || row.proposed_action === "update") {
        itemId = stringOrNull(decision.itemId) ?? itemId;
        if (!itemId || decision.confirmLink !== true) throw new Error("link_not_confirmed");
        const currentItem = await client.query(`select id,version from "yu_inventory"."items" where id=$1 for update`, [itemId]);
        if (!currentItem.rows[0]) throw new Error("link_item_missing");
        if (decision.expectedItemVersion !== undefined && Number(decision.expectedItemVersion) !== Number(currentItem.rows[0].version)) throw new Error("link_item_version_changed");
        const candidates = await this.findRowCandidates(client, batchId, asset.externalId);
        if (!candidates.some((candidate) => candidate.id === itemId)) throw new Error("link_candidate_no_longer_matches");
        const conflictingLink = await client.query(`select 1 from "yu_inventory"."item_one_c_links" where (item_id=$1 and external_id<>$2) or (external_id=$2 and item_id<>$1) limit 1 for update`, [itemId, asset.externalId]);
        if (conflictingLink.rows[0]) throw new Error("link_candidate_already_connected");
        outcome = row.proposed_action === "update" ? "updated" : "linked";
      }
      if (!itemId) { await client.query("commit"); return "skipped"; }
      const linkMethod = outcome === "created" ? "created_from_one_c" : Array.isArray(decision.matchedBy) ? "manual" : "inventory_number_confirmed";
      const linked = await client.query(`insert into "yu_inventory"."item_one_c_links"(external_id,item_id,source_code,source_inventory_number,linked_by,link_method,last_batch_id,last_payload_hash,accounting_status,accounting_residual_value,source_department,source_responsible_name,source_updated_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) on conflict(external_id) do update set last_batch_id=excluded.last_batch_id,last_payload_hash=excluded.last_payload_hash,source_code=excluded.source_code,source_inventory_number=excluded.source_inventory_number,accounting_status=excluded.accounting_status,accounting_residual_value=excluded.accounting_residual_value,source_department=excluded.source_department,source_responsible_name=excluded.source_responsible_name,source_updated_at=excluded.source_updated_at,version="yu_inventory"."item_one_c_links".version+1 where "yu_inventory"."item_one_c_links".item_id=excluded.item_id returning external_id`, [asset.externalId,itemId,asset.code,asset.inventoryNumber,actor.userId,linkMethod,batchId,row.payload_hash,asset.status,asset.residualCost,asset.location,asset.responsibleName,asset.updatedAt]);
      if (!linked.rows[0]) throw new Error("link_conflict");
      await client.query(`insert into "yu_inventory"."audit_records"(id,actor_id,actor_role_snapshot,subject_kind,subject_id,action,after_values,metadata) values($1,$2,$3,'item',$4,$5,$6::jsonb,$7::jsonb)`, [randomUUID(),actor.userId,actor.role,itemId,`item.one_c_${outcome}`,JSON.stringify({ externalId: asset.externalId, batchId }),JSON.stringify({ source: "one_c_reconciliation" })]);
      await client.query(`update "yu_inventory"."one_c_import_batch_rows" set review_state='published',published_item_id=$3,published_at=now() where batch_id=$1 and external_id=$2`, [batchId,asset.externalId,itemId]);
      await client.query("commit"); return outcome;
    } catch (error) { await client.query("rollback"); throw error; }
  }

  private async withDecision<T>(batchId: string, version: number, actor: OneCAdminActor, work: (client: PoolClient) => Promise<T>) { const client=await this.pool.connect(); try { await client.query("begin"); await this.lockBatch(client,batchId,version,["review_required"]); const value=await work(client); await client.query(`update "yu_inventory"."one_c_import_batches" set version=version+1 where id=$1`,[batchId]); await client.query("commit"); return value; } catch(e){await client.query("rollback").catch(()=>undefined);throw e;} finally{client.release();} }
  private async findRowCandidates(queryable: Pick<Pool, "query"> | Pick<PoolClient, "query">, batchId: string, externalId: string): Promise<ReconciliationCandidate[]> {
    const row = await queryable.query(`select payload from "yu_inventory"."one_c_import_batch_rows" where batch_id=$1 and external_id=$2`, [batchId, externalId]);
    if (!row.rows[0]) throw notFound();
    const asset = row.rows[0].payload as OneCFixedAsset;
    const inventoryKey = asset.inventoryNumber?.trim() ? inventoryNumberComparisonKey(asset.inventoryNumber) : null;
    const codeKey = oneCCodeComparisonKey(asset.code);
    const result = await queryable.query(`select i.id,i.name,i.inventory_number,i.one_c_code,i.status,i.version,
      exists(select 1 from "yu_inventory"."item_one_c_links" l where l.item_id=i.id and l.external_id=$1) as by_guid,
      ($2::text is not null and (upper(btrim(i.one_c_code))=$2 or exists(select 1 from "yu_inventory"."item_one_c_links" l where l.item_id=i.id and upper(btrim(l.source_code))=$2))) as by_code,
      ($3::text is not null and i.inventory_number_key=$3) as by_inventory_number
      from "yu_inventory"."items" i
      where i.item_section='general' and (
        exists(select 1 from "yu_inventory"."item_one_c_links" l where l.item_id=i.id and l.external_id=$1)
        or ($2::text is not null and (upper(btrim(i.one_c_code))=$2 or exists(select 1 from "yu_inventory"."item_one_c_links" l where l.item_id=i.id and upper(btrim(l.source_code))=$2)))
        or ($3::text is not null and i.inventory_number_key=$3))
      order by by_guid desc,by_inventory_number desc,by_code desc,i.name,i.id limit 100`, [externalId, codeKey, inventoryKey]);
    return result.rows.map((candidate) => ({
      id: String(candidate.id), name: String(candidate.name), inventoryNumber: String(candidate.inventory_number),
      oneCCode: stringOrNull(candidate.one_c_code), status: String(candidate.status), version: Number(candidate.version),
      matchedBy: ([candidate.by_guid && "guid", candidate.by_code && "code", candidate.by_inventory_number && "inventory_number"].filter(Boolean) as CandidateReason[]),
    })).sort((left, right) => right.matchedBy.length - left.matchedBy.length || left.name.localeCompare(right.name, "ru"));
  }
  private async lockBatch(client: PoolClient,id:string,version:number,states:string[]){const r=await client.query(`select * from "yu_inventory"."one_c_import_batches" where id=$1 and version=$2 and state=any($3::text[]) for update`,[id,version,states]);if(!r.rows[0])throw new ApplicationError("conflict","batch_version_conflict");return r.rows[0];}
  private async assertBatch(id:string){if(!(await this.pool.query(`select 1 from "yu_inventory"."one_c_import_batches" where id=$1`,[id])).rows[0])throw notFound();}
}

type Workflow={state:string;action:string;planAction:"create"|"link"|"update"|"exclude"|"blocked"|"conflict";bucket:string};
function workflowFor(result:string,itemId:string|null):Workflow{if(result==="excluded_non_physical")return{state:"excluded",action:"exclude",planAction:"exclude",bucket:"excluded"};if(result.startsWith("blocked_")||result==="manual_review")return{state:"blocked",action:"manual_review",planAction:"blocked",bucket:"blocked"};if(result==="conflict_inventory_number")return{state:"conflict",action:"manual_review",planAction:"conflict",bucket:"conflicts"};if(result==="new_publishable")return{state:"ready",action:"create",planAction:"create",bucket:"create"};return{state:itemId?"matched":"ready",action:itemId?"link":"manual_review",planAction:itemId?"link":"blocked",bucket:"matched"};}
function stringOrNull(value:unknown){return typeof value==="string"&&value.trim()?value.trim():null;}
function escapeLikePattern(value:string){return value.replace(/[\\%_]/gu,(character)=>`\\${character}`);}
function oneCCodeComparisonKey(value:unknown){const normalized=stringOrNull(value);return normalized?normalized.normalize("NFKC").toUpperCase():null;}
function exactCandidateReasons(asset:OneCFixedAsset,candidate:Row,linkedItemId:string|undefined,codeLinkMap:ReadonlyMap<string,string[]>):CandidateReason[]{
  const reasons:CandidateReason[]=[];
  const id=String(candidate.id);
  if(linkedItemId===id)reasons.push("guid");
  const codeKey=oneCCodeComparisonKey(asset.code);
  if(codeKey&&(oneCCodeComparisonKey(candidate.one_c_code)===codeKey||(codeLinkMap.get(codeKey)??[]).includes(id)))reasons.push("code");
  if(asset.inventoryNumber?.trim()&&inventoryNumberComparisonKey(String(candidate.inventory_number))===inventoryNumberComparisonKey(asset.inventoryNumber))reasons.push("inventory_number");
  return reasons;
}
function manualLinkHasNoUnresolvedBlockingIssues(issues:readonly {code:string;severity:string}[]){
  // The administrator's explicit item choice resolves disagreement between the
  // three requested source identifiers. Link occupancy and optimistic version
  // conflicts are checked separately and can never be overridden here.
  const resolvedByManualChoice=new Set(["identifier_conflict","missing_inventory_number","missing_room","unsupported_item_type","invalid_one_c_barcode"]);
  return !issues.some((entry)=>entry.severity==="blocking"&&!resolvedByManualChoice.has(entry.code));
}
function notFound(){return new ApplicationError("not_found","one_c_resource_not_found");}
function isPgUniqueViolation(error:unknown){return typeof error==="object"&&error!==null&&"code" in error&&error.code==="23505";}
