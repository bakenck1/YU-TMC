import "server-only";

import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { getDatabasePool } from "@/lib/db/client";
import { ApplicationError } from "@/lib/domain/application-error";
import { inventoryNumberComparisonKey } from "@/lib/domain/code39";
import { MAX_MATERIAL_SNAPSHOT_BYTES, parseMaterialSnapshot } from "@/lib/server/material-snapshot";

const SCHEMA = '"yu_inventory"';

export type MaterialSnapshotMetadata = {
  id: string;
  filename: string;
  sha256: string;
  byteSize: number;
  receivedAt: string;
  acceptedCount: number;
  skippedCount: number;
  selectedAt: string;
};

type Database = Pick<Pool, "query" | "connect">;

export async function getSelectedMaterialSnapshot(db: Database = getDatabasePool()): Promise<MaterialSnapshotMetadata | null> {
  const result = await db.query(`select s.id,s.filename,s.sha256,s.byte_size,s.received_at,s.accepted_count,s.skipped_count,ch.selected_at
    from ${SCHEMA}."material_snapshot_selection" ch join ${SCHEMA}."material_snapshots" s on s.id=ch.snapshot_id where ch.id=1`);
  return result.rows[0] ? metadata(result.rows[0]) : null;
}

export async function uploadMaterialSnapshot(filename: string, bytes: Buffer, userId: string, db: Database = getDatabasePool()): Promise<MaterialSnapshotMetadata> {
  if (!filename.toLowerCase().endsWith(".xls") || filename.length > 180 || /[\\/\x00-\x1f]/u.test(filename) || bytes.length > MAX_MATERIAL_SNAPSHOT_BYTES) {
    throw new ApplicationError("validation", "invalid_material_snapshot_file");
  }
  const parsed = parseMaterialSnapshot(bytes);
  const client = await db.connect();
  let selected: MaterialSnapshotMetadata;
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(726329014)");
    const existing = await client.query(`select id,byte_size,accepted_count,skipped_count from ${SCHEMA}."material_snapshots" where sha256=$1`, [parsed.sha256.toLowerCase()]);
    let snapshotId: string;
    if (existing.rows[0]) {
      const row = existing.rows[0];
      if (Number(row.byte_size) !== bytes.length || Number(row.accepted_count) !== parsed.accepted.length || Number(row.skipped_count) !== parsed.skipped) {
        throw new Error("material_snapshot_existing_metadata_mismatch");
      }
      snapshotId = String(row.id);
    } else {
      snapshotId = randomUUID();
      await client.query(`insert into ${SCHEMA}."material_snapshots"(id,filename,sha256,byte_size,source_file,accepted_count,skipped_count) values($1,$2,$3,$4,$5,$6,$7)`, [snapshotId, filename, parsed.sha256.toLowerCase(), bytes.length, bytes, parsed.accepted.length, parsed.skipped]);
      for (let start = 0; start < parsed.accepted.length; start += 500) {
        const rows = parsed.accepted.slice(start, start + 500).map((row) => ({ row_number: row.rowNumber, nomenclature: row.nomenclature, inventory_number: row.inventoryNumber, number_key: inventoryNumberComparisonKey(row.inventoryNumber), ending_balance: row.endingBalance }));
        await client.query(`insert into ${SCHEMA}."material_snapshot_rows"(snapshot_id,row_number,nomenclature,inventory_number,number_key,ending_balance)
          select $1,x.row_number,x.nomenclature,x.inventory_number,x.number_key,x.ending_balance from jsonb_to_recordset($2::jsonb)
          as x(row_number integer,nomenclature text,inventory_number text,number_key text,ending_balance text)`, [snapshotId, JSON.stringify(rows)]);
      }
    }
    await client.query(`insert into ${SCHEMA}."material_snapshot_selection"(id,snapshot_id,selected_by) values(1,$1,$2)
      on conflict (id) do update set snapshot_id=excluded.snapshot_id,selected_by=excluded.selected_by,selected_at=now()`, [snapshotId, userId]);
    const result = await client.query(`select s.id,s.filename,s.sha256,s.byte_size,s.received_at,s.accepted_count,s.skipped_count,ch.selected_at
      from ${SCHEMA}."material_snapshot_selection" ch join ${SCHEMA}."material_snapshots" s on s.id=ch.snapshot_id where ch.id=1`);
    selected = metadata(result.rows[0]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
  return selected;
}

function metadata(row: Record<string, unknown>): MaterialSnapshotMetadata {
  return {
    id: String(row.id), filename: String(row.filename), sha256: String(row.sha256).toUpperCase(),
    byteSize: Number(row.byte_size), receivedAt: new Date(String(row.received_at)).toISOString(),
    acceptedCount: Number(row.accepted_count), skippedCount: Number(row.skipped_count),
    selectedAt: new Date(String(row.selected_at)).toISOString(),
  };
}
