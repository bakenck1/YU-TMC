import "server-only";

import type { QueryResultRow } from "pg";

import type {
  UpsertWebPushSubscriptionRecord,
  WebPushRepositories,
  WebPushSubscriptionRecord,
  WebPushSubscriptionRepository,
  TmcPushOutboxEventRecord,
  TmcPushOutboxRepository,
} from "@/lib/application/ports/web-push-repositories";
import type { PostgresRepositorySource } from "@/lib/server/persistence/postgres/postgres-unit-of-work";
import {
  assertCollectionSize,
  COLLECTION_LIMITS,
  sqlCollectionLimit,
} from "@/lib/server/persistence/collection-limits";

const SUBSCRIPTIONS = '"yu_inventory"."web_push_subscriptions"';
const USERS = '"yu_inventory"."users"';
const OUTBOX = '"yu_inventory"."tmc_web_push_outbox"';
const EVENTS = '"yu_inventory"."notification_events"';
const TMC_NOTIFICATIONS = '"yu_inventory"."tmc_operation_notifications"';
const DELIVERIES = '"yu_inventory"."notification_deliveries"';
const REQUESTS = '"yu_inventory"."tmc_transfer_requests"';
const PUSH_DELIVERIES = '"yu_inventory"."tmc_web_push_delivery_attempts"';

interface SubscriptionRow extends QueryResultRow {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  expiration_time: Date | null;
  user_agent: string | null;
  language: "ru" | "kk" | "en";
  created_at: Date;
  updated_at: Date;
}

export function createPostgresWebPushRepositories(
  source: PostgresRepositorySource,
): WebPushRepositories {
  return {
    webPushSubscriptions: new PostgresWebPushSubscriptionRepository(source),
    tmcPushOutbox: new PostgresTmcPushOutboxRepository(source),
  };
}

class PostgresTmcPushOutboxRepository implements TmcPushOutboxRepository {
  constructor(private readonly source: PostgresRepositorySource) {}

  async claim(input: { workerId: string; now: Date; lockedUntil: Date; limit: number }): Promise<TmcPushOutboxEventRecord[]> {
    await this.source.query(
      `update ${OUTBOX} outbox
          set processed_at = $1, last_error_code = 'event_no_longer_deliverable'
         from ${EVENTS} event
         join ${TMC_NOTIFICATIONS} notification on notification.notification_event_id = event.id
         join ${REQUESTS} request on request.id = notification.request_id
        where outbox.notification_event_id = event.id
          and outbox.processed_at is null
          and event.type = 'tmc_transfer.overdue'
          and (request.status <> 'pending' or request.expires_at > $1)`,
      [input.now],
    );
    const claimed = await this.source.query<{
      event_id: string; type: TmcPushOutboxEventRecord["type"];
      request_id: string; safe_payload: Record<string, string | number | boolean | null>;
      attempt: number | string;
    } & QueryResultRow>(
       `with candidates as (
         select outbox.notification_event_id
           from ${OUTBOX} outbox
           join ${EVENTS} event on event.id = outbox.notification_event_id
           join ${TMC_NOTIFICATIONS} notification on notification.notification_event_id = event.id
           join ${REQUESTS} request on request.id = notification.request_id
          where outbox.processed_at is null
            and outbox.dead_lettered_at is null
            and outbox.available_at <= $2
            and (outbox.locked_until is null or outbox.locked_until < $2)
            and event.occurred_at <= $2
            and (event.type <> 'tmc_transfer.overdue'
                 or (request.status = 'pending' and request.expires_at <= $2))
          order by outbox.available_at, outbox.notification_event_id
          for update of outbox skip locked
          limit $3
       ), updated as (
         update ${OUTBOX} outbox
            set locked_by = $1, locked_until = $4, attempts = outbox.attempts + 1
           from candidates
          where outbox.notification_event_id = candidates.notification_event_id
          returning outbox.notification_event_id, outbox.attempts
       )
       select event.id as event_id, event.type, notification.request_id,
              event.safe_payload, updated.attempts as attempt
         from updated
         join ${EVENTS} event on event.id = updated.notification_event_id
         join ${TMC_NOTIFICATIONS} notification on notification.notification_event_id = event.id
        order by event.occurred_at, event.id`,
      [input.workerId, input.now, input.limit, input.lockedUntil],
    );
    const records: TmcPushOutboxEventRecord[] = [];
    for (const row of claimed.rows) {
      const recipients = await this.source.query<{ recipient_id: string } & QueryResultRow>(
        `select distinct recipient_id from (
           select delivery.recipient_id
             from ${DELIVERIES} delivery
            where delivery.event_id = $1
           union all
           select admin.id
             from ${EVENTS} event
             join ${USERS} admin on admin.role = 'admin'
              and admin.is_active = true and admin.deleted_at is null
            where event.id = $1 and event.audience_kind = 'admin_queue'
         ) recipients
         order by recipient_id`,
        [row.event_id],
      );
      records.push({
        eventId: row.event_id, type: row.type, requestId: row.request_id,
        safePayload: row.safe_payload, recipientIds: recipients.rows.map((entry) => entry.recipient_id),
        attempt: Number(row.attempt),
      });
    }
    return records;
  }

  async complete(input: { eventId: string; workerId: string; completedAt: Date }): Promise<void> {
    await this.source.query(
      `update ${OUTBOX} set processed_at = $3, locked_by = null, locked_until = null,
              last_error_code = null
        where notification_event_id = $1 and locked_by = $2 and processed_at is null`,
      [input.eventId, input.workerId, input.completedAt],
    );
  }

  async retry(input: { eventId: string; workerId: string; availableAt: Date; errorCode: string; deadLetter: boolean }): Promise<void> {
    await this.source.query(
      `update ${OUTBOX}
          set available_at = $3, locked_by = null, locked_until = null,
              last_error_code = $4,
              dead_lettered_at = case when $5 then now() else dead_lettered_at end
        where notification_event_id = $1 and locked_by = $2 and processed_at is null`,
      [input.eventId, input.workerId, input.availableAt, input.errorCode.slice(0, 120), input.deadLetter],
    );
  }

  async reserveDelivery(input: { eventId: string; subscriptionId: string; subscriptionUpdatedAt: Date; workerId: string; now: Date; lockedUntil: Date }): Promise<"reserved" | "delivered" | "busy" | "cancelled"> {
    const reserved = await this.source.query(
      `insert into ${PUSH_DELIVERIES}
         (notification_event_id, subscription_id, subscription_updated_at,
          attempts, locked_by, locked_until)
       select $1, $2, $3, 1, $4, $6
         from ${OUTBOX} outbox
         join ${EVENTS} event on event.id = outbox.notification_event_id
         join ${TMC_NOTIFICATIONS} notification on notification.notification_event_id = event.id
         join ${REQUESTS} request on request.id = notification.request_id
        where outbox.notification_event_id = $1
          and outbox.processed_at is null and outbox.dead_lettered_at is null
          and (event.type <> 'tmc_transfer.overdue'
               or (request.status = 'pending' and request.expires_at <= $5))
       on conflict (notification_event_id, subscription_id) do update
         set subscription_updated_at = excluded.subscription_updated_at,
             attempts = ${PUSH_DELIVERIES}.attempts + 1,
             locked_by = excluded.locked_by, locked_until = excluded.locked_until,
             last_error_code = null
       where ${PUSH_DELIVERIES}.delivered_at is null
         and (${PUSH_DELIVERIES}.locked_until is null
              or ${PUSH_DELIVERIES}.locked_until < $5
              or ${PUSH_DELIVERIES}.locked_by = $4)
       returning 1`,
      [input.eventId, input.subscriptionId, input.subscriptionUpdatedAt,
       input.workerId, input.now, input.lockedUntil],
    );
    if ((reserved.rowCount ?? 0) > 0) return "reserved";
    const state = await this.source.query<{ delivered_at: Date | null; exists: boolean } & QueryResultRow>(
      `select delivery.delivered_at, true as exists
         from ${PUSH_DELIVERIES} delivery
        where delivery.notification_event_id = $1 and delivery.subscription_id = $2`,
      [input.eventId, input.subscriptionId],
    );
    if (state.rows[0]?.delivered_at) return "delivered";
    if (state.rows[0]?.exists) return "busy";
    return "cancelled";
  }

  async completeDelivery(input: { eventId: string; subscriptionId: string; workerId: string; completedAt: Date }): Promise<void> {
    await this.source.query(
      `update ${PUSH_DELIVERIES}
          set delivered_at = $4, locked_by = null, locked_until = null,
              last_error_code = null
        where notification_event_id = $1 and subscription_id = $2
          and locked_by = $3 and delivered_at is null`,
      [input.eventId, input.subscriptionId, input.workerId, input.completedAt],
    );
  }

  async failDelivery(input: { eventId: string; subscriptionId: string; workerId: string; errorCode: string }): Promise<void> {
    await this.source.query(
      `update ${PUSH_DELIVERIES}
          set locked_by = null, locked_until = null, last_error_code = $4
        where notification_event_id = $1 and subscription_id = $2
          and locked_by = $3 and delivered_at is null`,
      [input.eventId, input.subscriptionId, input.workerId, input.errorCode.slice(0, 120)],
    );
  }
}

class PostgresWebPushSubscriptionRepository
  implements WebPushSubscriptionRepository
{
  constructor(private readonly source: PostgresRepositorySource) {}

  async lockUserSubscriptions(userId: string): Promise<void> {
    await this.source.query(
      "select pg_advisory_xact_lock(hashtextextended($1, 0))",
      [userId],
    );
  }

  async upsert(
    input: UpsertWebPushSubscriptionRecord,
  ): Promise<WebPushSubscriptionRecord | null> {
    const result = await this.source.query<SubscriptionRow>(
      `insert into ${SUBSCRIPTIONS} as existing
         (id, user_id, endpoint, p256dh, auth, expiration_time, user_agent,
          language, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
       on conflict (endpoint) do update
       set user_id = excluded.user_id,
           p256dh = excluded.p256dh,
           auth = excluded.auth,
           expiration_time = excluded.expiration_time,
           user_agent = excluded.user_agent,
           language = excluded.language,
           updated_at = excluded.updated_at
       where existing.user_id = excluded.user_id
       returning id, user_id, endpoint, p256dh, auth, expiration_time,
                 user_agent, language, created_at, updated_at`,
      [
        input.id,
        input.userId,
        input.endpoint,
        input.p256dh,
        input.auth,
        input.expirationTime,
        input.userAgent,
        input.language,
        input.now,
      ],
    );
    const row = result.rows[0];
    return row ? mapSubscription(row) : null;
  }

  async listByUser(userId: string): Promise<WebPushSubscriptionRecord[]> {
    const result = await this.source.query<SubscriptionRow>(
      `select s.id, s.user_id, s.endpoint, s.p256dh, s.auth,
              s.expiration_time,
              s.user_agent, s.language, s.created_at, s.updated_at
         from ${SUBSCRIPTIONS} s
         join ${USERS} u on u.id = s.user_id
        where s.user_id = $1
          and u.is_active = true
          and u.deleted_at is null
          and u.role in ('admin', 'warehouse', 'employee')
        order by s.updated_at desc, s.id
        ${sqlCollectionLimit(COLLECTION_LIMITS.pushSubscriptionsPerUser)}`,
      [userId],
    );
    return assertCollectionSize(
      result.rows,
      COLLECTION_LIMITS.pushSubscriptionsPerUser,
      "push_subscriptions_too_large",
    ).map(mapSubscription);
  }

  async deleteOlderThanLimit(userId: string, keep: number): Promise<void> {
    await this.source.query(
      `delete from ${SUBSCRIPTIONS}
        where user_id = $1
          and id in (
          select id
            from ${SUBSCRIPTIONS}
           where user_id = $1
           order by updated_at desc, id
           offset $2
        )`,
      [userId, keep],
    );
  }

  async deleteForUser(userId: string, endpoint: string): Promise<void> {
    await this.source.query(
      `delete from ${SUBSCRIPTIONS} where user_id = $1 and endpoint = $2`,
      [userId, endpoint],
    );
  }

  async deleteIfUnchanged(
    subscription: Pick<
      WebPushSubscriptionRecord,
      | "id"
      | "userId"
      | "endpoint"
      | "p256dh"
      | "auth"
      | "expirationTime"
      | "language"
      | "updatedAt"
    >,
  ): Promise<void> {
    await this.source.query(
      `delete from ${SUBSCRIPTIONS}
        where id = $1
          and user_id = $2
          and endpoint = $3
          and p256dh = $4
          and auth = $5
          and expiration_time is not distinct from $6
          and language = $7
          and updated_at = $8`,
      [
        subscription.id,
        subscription.userId,
        subscription.endpoint,
        subscription.p256dh,
        subscription.auth,
        subscription.expirationTime,
        subscription.language,
        subscription.updatedAt,
      ],
    );
  }
}

function mapSubscription(row: SubscriptionRow): WebPushSubscriptionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    endpoint: row.endpoint,
    p256dh: row.p256dh,
    auth: row.auth,
    expirationTime: row.expiration_time,
    userAgent: row.user_agent,
    language: row.language,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
