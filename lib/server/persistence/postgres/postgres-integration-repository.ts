import "server-only";
import { getDatabasePool } from "@/lib/db/client";
import type { IntegrationChange, IntegrationRecord, IntegrationRepository } from "@/lib/contracts/integration-api";
import { integrationProjections, projectionSql } from "@/lib/server/integration-projections";
import { ApplicationError } from "@/lib/domain/application-error";

const MAX_ID = "9223372036854775807";
// XIDs, unlike sequence values, let us wait for *all* older writers before
// advancing a cursor. Sequence-only cursors silently lose out-of-order commits.
const watermark = "(pg_snapshot_xmin(pg_current_snapshot())::text::numeric - 1)::text";

export function createPostgresIntegrationRepository(pool = getDatabasePool()): IntegrationRepository {
  return {
    async checkpoint() {
      const result = await pool.query<{ xid: string }>(`select ${watermark} as xid`);
      return `${result.rows[0]!.xid}:${MAX_ID}`;
    },
    async list(entity, after, limit) {
      const { table } = integrationProjections[entity];
      const result = await pool.query<{ data: IntegrationRecord }>(
        `select ${projectionSql(entity, "r")} as data from "yu_inventory"."${table}" r
         where ($1::uuid is null or r.id > $1::uuid) order by r.id limit $2`, [after, limit],
      );
      return result.rows.map((row) => row.data);
    },
    async changes(after, limit) {
      const [xid, id] = after.split(":");
      // XID order makes replay complete, but it is not row mutation order. A
      // lower-XID transaction can write a row after a higher-XID writer commits.
      // Return the latest committed per-record journal state for every change;
      // a delayed event can then never resurrect obsolete data. The original
      // event still supplies the replay cursor, and head.id supplies revision.
      const result = await pool.query<{
        watermark: string; changes: IntegrationChange[];
      }>(`with boundary as materialized (select ${watermark} as xid), page as (
        select e.transaction_id, e.id, jsonb_build_object(
          'cursor', e.transaction_id::text || ':' || e.id::text,
          'revision', head.id::text,
          'entity', e.entity, 'operation', head.operation, 'recordId', e.record_id,
          'data', head.payload, 'occurredAt', head.occurred_at) as data
        from "yu_inventory"."integration_events" e, boundary b
        cross join lateral (
          select latest.id, latest.operation, latest.payload, latest.occurred_at
          from "yu_inventory"."integration_events" latest
          where latest.entity = e.entity and latest.record_id = e.record_id
          order by latest.id desc limit 1
        ) head
        where (e.transaction_id, e.id) > ($1::xid8, $2::bigint)
          and e.transaction_id <= b.xid::xid8
        order by e.transaction_id, e.id limit $3
      ) select b.xid as watermark,
        coalesce((select jsonb_agg(p.data order by p.transaction_id, p.id) from page p), '[]'::jsonb) as changes
        from boundary b`, [xid, id, limit + 1]);
      const row = result.rows[0]!;
      const upper = `${row.watermark}:${MAX_ID}`;
      if (BigInt(xid) > BigInt(row.watermark)) throw new ApplicationError("validation", "cursor_ahead_of_feed");
      const changes = row.changes.slice(0, limit);
      const hasMore = row.changes.length > limit;
      return { changes, hasMore, nextCursor: hasMore ? changes.at(-1)!.cursor : upper };
    },
  };
}
