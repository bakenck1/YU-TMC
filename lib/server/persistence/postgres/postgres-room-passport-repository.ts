import "server-only";
import { randomUUID } from "node:crypto";
import type { QueryResultRow } from "pg";
import type { PassportRepositories, PassportRecord, PassportUpload } from "@/lib/application/ports/room-passport-repositories";
import type { PassportActor } from "@/lib/application/services/room-passport-service";
import { ApplicationError } from "@/lib/domain/application-error";
import { hasPermission } from "@/lib/security/permissions";
import type { PostgresRepositorySource } from "@/lib/server/persistence/postgres/postgres-unit-of-work";
import { assertCollectionSize, sqlCollectionLimit, COLLECTION_LIMITS } from "@/lib/server/persistence/collection-limits";

const TABLE = '"yu_inventory"."room_passports"';
const SELECT = `select r.id as "roomId", r.building_id as "buildingId", b.name as "buildingName",
 r.floor_number as "floorNumber", r.floor_label as "floorLabel", r.designation,
 coalesce(p.status, 'not_started') as status, coalesce(p.version, 0) as version,
 p.file_id as "fileId", p.file_name as "fileName", p.file_size as "fileSize",
 p.uploaded_by as "uploadedBy", p.submitted_by as "submittedBy",
 p.rejection_reason as "rejectionReason", p.rejection_comment as "rejectionComment"
 from "yu_inventory"."rooms" r join "yu_inventory"."buildings" b on b.id = r.building_id
 left join ${TABLE} p on p.room_id = r.id
 where r.status = 'active' and b.status = 'active'`;

export function createPostgresPassportRepositories(source: PostgresRepositorySource): PassportRepositories {
  return { passports: new PostgresPassportRepository(source) };
}

class PostgresPassportRepository {
  constructor(private readonly source: PostgresRepositorySource) {}
  async list() {
    const result = await this.source.query<PassportRecord & QueryResultRow>(`${SELECT} order by b.name, r.floor_number, r.designation, r.id ${sqlCollectionLimit(COLLECTION_LIMITS.facilitiesRooms)}`);
    return assertCollectionSize(result.rows, COLLECTION_LIMITS.facilitiesRooms);
  }
  async find(roomId: string) {
    const result = await this.source.query<PassportRecord & QueryResultRow>(`${SELECT} and r.id = $1`, [roomId]);
    return result.rows[0] ?? null;
  }
  async lock(roomId: string, actor: PassportActor) {
    const user = await this.source.query(`select id from "yu_inventory"."users" where id = $1 and role = $2 and version = $3 and is_active and deleted_at is null for share`, [actor.userId, actor.role, actor.sessionVersion]);
    if (!user.rowCount) throw new ApplicationError("unauthorized", "unauthorized");
    // The room is the stable lock even before its first passport is created.
    const room = await this.source.query(`select r.id from "yu_inventory"."rooms" r join "yu_inventory"."buildings" b on b.id = r.building_id where r.id = $1 and r.status = 'active' and b.status = 'active' for update of r for share of b`, [roomId]);
    if (!room.rowCount) throw new ApplicationError("not_found", "room_not_found");
    await this.source.query(`insert into ${TABLE} (room_id) values ($1) on conflict (room_id) do nothing`, [roomId]);
    return (await this.find(roomId))!;
  }
  async save(row: PassportRecord, upload?: PassportUpload) {
    const result = await this.source.query(`update ${TABLE} set status = $2, version = $3,
     file_id = $4, file_name = $5, file_size = $6, uploaded_by = $7, submitted_by = $8,
     rejection_reason = $9, rejection_comment = $10,
     binary_data = case when $4::uuid is null then null when $12 then $11::bytea else binary_data end
     where room_id = $1 and version = $13`,
      [row.roomId, row.status, row.version, row.fileId, row.fileName, row.fileSize, row.uploadedBy, row.submittedBy, row.rejectionReason, row.rejectionComment, upload ? Buffer.from(upload.bytes) : null, Boolean(upload), row.version - 1]);
    if (result.rowCount !== 1) throw new ApplicationError("conflict", "passport_conflict");
  }
  async file(roomId: string, fileId: string, actor: PassportActor, published: boolean) {
    const result = await this.source.query<{ bytes: Uint8Array; name: string } & QueryResultRow>(
      `select p.binary_data as bytes, p.file_name as name from ${TABLE} p
       join "yu_inventory"."rooms" r on r.id = p.room_id
       join "yu_inventory"."buildings" b on b.id = r.building_id
       join "yu_inventory"."users" viewer on viewer.id = $5 and viewer.version = $6 and viewer.role = $7
        and viewer.is_active and viewer.deleted_at is null
       where p.room_id = $1 and p.file_id = $2 and r.status = 'active' and b.status = 'active'
       and (not $3::boolean or (p.status = 'approved' and (
         $4::boolean or r.access_mode = 'open' or
         exists (select 1 from "yu_inventory"."items" i join "yu_inventory"."responsibility_periods" rp on rp.item_id = i.id and rp.ended_at is null
          where i.room_id = r.id and i.archived_at is null and i.item_section = 'general' and rp.responsible_user_id = $5) or
         exists (select 1 from "yu_inventory"."local_item_groups" g join "yu_inventory"."items" i on i.id = g.item_id
          where g.room_id = r.id and g.status = 'active' and i.item_section = 'general' and g.responsible_user_id = $5))))`,
      [roomId, fileId, published, hasPermission(actor.role, "inventory.room.read_all"), actor.userId, actor.sessionVersion, actor.role]);
    return result.rows[0] ?? null;
  }
  async notify(row: PassportRecord, actorId: string, event: "submitted" | "approved" | "rejected") {
    const recipients = event === "submitted"
      ? await this.source.query<{ id: string } & QueryResultRow>(`select id from "yu_inventory"."users" where role = 'passport_reviewer' and is_active and deleted_at is null order by id`)
      : { rows: row.submittedBy ? [{ id: row.submittedBy }] : [] };
    for (const recipient of recipients.rows) {
      const id = randomUUID();
      const mailbox = await this.source.query<{ sequence: string } & QueryResultRow>(`insert into "yu_inventory"."notification_mailboxes" (id, kind, user_id, next_sequence)
       values ($1, 'direct_user', $2, 2) on conflict (user_id) where kind = 'direct_user'
       do update set next_sequence = "yu_inventory"."notification_mailboxes".next_sequence + 1 returning (next_sequence - 1)::text as sequence`, [randomUUID(), recipient.id]);
      await this.source.query(`insert into "yu_inventory"."notification_events"
       (id, domain_event_id, type, actor_id, subject_kind, subject_id, subject_revision, audience_kind, safe_payload, occurred_at)
       values ($1,$1,$2,$3,'room_passport',$4,$5,'direct_user',$6,now())`,
        [id, `passport.${event}`, actorId, row.roomId, row.version, { roomId: row.roomId, room: row.designation, building: row.buildingName, reason: row.rejectionReason, comment: row.rejectionComment }]);
      await this.source.query(`insert into "yu_inventory"."notification_deliveries" (event_id, recipient_id, mailbox_sequence, created_at) values ($1,$2,$3,now())`, [id, recipient.id, mailbox.rows[0].sequence]);
    }
  }
}
