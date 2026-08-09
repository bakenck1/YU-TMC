import "server-only";

import type { QueryResultRow } from "pg";

import type {
  UpsertWebPushSubscriptionRecord,
  WebPushRepositories,
  WebPushSubscriptionRecord,
  WebPushSubscriptionRepository,
} from "@/lib/application/ports/web-push-repositories";
import type { PostgresRepositorySource } from "@/lib/server/persistence/postgres/postgres-unit-of-work";

const SUBSCRIPTIONS = '"yu_inventory"."web_push_subscriptions"';
const USERS = '"yu_inventory"."users"';

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
  };
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
  ): Promise<WebPushSubscriptionRecord> {
    const result = await this.source.query<SubscriptionRow>(
      `insert into ${SUBSCRIPTIONS}
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
    if (!row) throw new Error("push_subscription_upsert_failed");
    return mapSubscription(row);
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
        order by s.updated_at desc, s.id`,
      [userId],
    );
    return result.rows.map(mapSubscription);
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
